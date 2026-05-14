import express from 'express';
import prisma from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// IBAN simulat pentru demo
const FORJA_IBAN = 'RO49AAAA1B31007593840000';
const FORJA_BANK = 'Banca Transilvania';
const FORJA_BENEFICIAR = 'FORJA TECH SRL';

const PLAN_PRICES = { FREE: 0, PRO: 29, TEAM: 49 };
const getPlanPrice = (plan) => PLAN_PRICES[plan] ?? 0;

// Helper: parse detail (poate fi JSON string sau text plain)
function parseDetail(detail) {
  if (!detail) return {};
  if (typeof detail === 'object') return detail;
  try { return JSON.parse(detail); } catch { return { text: String(detail) }; }
}

// Helper: stringify detail pentru salvare
function stringifyDetail(obj) {
  return JSON.stringify(obj);
}

// POST /upgrade/request — utilizator existent cere upgrade plan
router.post('/request', authenticate, async (req, res) => {
  try {
    const { plan, email } = req.body;
    if (!plan || !['PRO', 'TEAM'].includes(plan)) {
      return res.status(400).json({ error: 'Plan invalid. Doar PRO sau TEAM.' });
    }
    const userEmail = String(email || '').trim().toLowerCase() || req.user.email;
    if (!userEmail || !userEmail.includes('@')) {
      return res.status(400).json({ error: 'Email invalid.' });
    }
    if (req.user.plan === plan) {
      return res.status(400).json({ error: `Ai deja planul ${plan}.` });
    }
    const existing = await prisma.auditLog.findFirst({
      where: { userId: req.user.id, action: 'UPGRADE_REQUEST' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const data = parseDetail(existing.detail);
      if (data.status === 'PENDING') {
        return res.status(409).json({ error: 'Ai deja o cerere de upgrade în așteptare.' });
      }
    }
    const amount = getPlanPrice(plan);
    const requestId = `UPG-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      requestId, fromPlan: req.user.plan, toPlan: plan, email: userEmail,
      amount, iban: FORJA_IBAN, bank: FORJA_BANK, beneficiar: FORJA_BENEFICIAR,
      status: 'PENDING', type: 'UPGRADE',
    };
    const log = await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPGRADE_REQUEST',
        type: 'billing',
        status: 'INFO',
        detail: stringifyDetail(payload),
      },
    });
    res.json({
      ok: true, requestId, iban: FORJA_IBAN, bank: FORJA_BANK, beneficiar: FORJA_BENEFICIAR,
      amount, plan, email: userEmail, logId: log.id,
    });
  } catch (err) {
    console.error('[upgrade/request] error:', err);
    res.status(500).json({ error: 'Eroare server la creare cerere upgrade.' });
  }
});

// POST /upgrade/cancel
router.post('/cancel', authenticate, async (req, res) => {
  try {
    if (req.user.plan === 'FREE') {
      return res.status(400).json({ error: 'Ești deja pe planul FREE.' });
    }
    const oldPlan = req.user.plan;
    await prisma.user.update({ where: { id: req.user.id }, data: { plan: 'FREE' } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.id, action: 'PLAN_DOWNGRADE',
        type: 'billing', status: 'WARNING',
        detail: stringifyDetail({ from: oldPlan, to: 'FREE', reason: 'user_cancellation' }),
      },
    });
    res.json({ ok: true, message: 'Abonamentul a fost anulat. Ești acum pe planul FREE.' });
  } catch (err) {
    console.error('[upgrade/cancel] error:', err);
    res.status(500).json({ error: 'Eroare server la downgrade.' });
  }
});

// GET /upgrade/my-request
router.get('/my-request', authenticate, async (req, res) => {
  try {
    const log = await prisma.auditLog.findFirst({
      where: { userId: req.user.id, action: 'UPGRADE_REQUEST' },
      orderBy: { createdAt: 'desc' },
    });
    if (!log) return res.json({ request: null });
    const data = parseDetail(log.detail);
    res.json({ request: { id: log.id, ...data, createdAt: log.createdAt } });
  } catch (err) {
    console.error('[upgrade/my-request] error:', err);
    res.status(500).json({ error: 'Eroare server.' });
  }
});

// === ADMIN ===

router.get('/admin/list', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { action: 'UPGRADE_REQUEST' },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))];
    const users = userIds.length ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, plan: true, blocked: true },
    }) : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    res.json({
      requests: logs.map(log => {
        const data = parseDetail(log.detail);
        return {
          id: log.id, userId: log.userId, user: userMap[log.userId] || null,
          ...data, createdAt: log.createdAt,
        };
      }),
    });
  } catch (err) {
    console.error('[upgrade/admin/list] error:', err);
    res.status(500).json({ error: 'Eroare server la încărcare cereri.' });
  }
});

router.post('/admin/:id/approve', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const log = await prisma.auditLog.findUnique({ where: { id: req.params.id } });
    if (!log || log.action !== 'UPGRADE_REQUEST') return res.status(404).json({ error: 'Cerere inexistentă' });
    const data = parseDetail(log.detail);
    if (data.status !== 'PENDING') return res.status(409).json({ error: 'Cererea nu mai e în așteptare.' });
    await prisma.user.update({
      where: { id: log.userId },
      data: { plan: data.toPlan, blocked: false },
    });
    const updated = { ...data, status: 'APPROVED', approvedAt: new Date().toISOString(), approvedBy: req.user.id };
    await prisma.auditLog.update({
      where: { id: log.id },
      data: { detail: stringifyDetail(updated), status: 'SUCCESS' },
    });
    await prisma.auditLog.create({
      data: {
        userId: log.userId, action: 'UPGRADE_APPROVED',
        type: 'billing', status: 'SUCCESS',
        detail: stringifyDetail({ requestId: data.requestId, plan: data.toPlan, approvedBy: req.user.email }),
      },
    });
    global.__io?.to(`user:${log.userId}`).emit('upgrade:approved', { plan: data.toPlan, requestId: data.requestId });
    res.json({ ok: true, message: 'Cerere aprobată. User-ul are acum planul ' + data.toPlan });
  } catch (err) {
    console.error('[upgrade/admin/approve] error:', err);
    res.status(500).json({ error: 'Eroare server la aprobare.' });
  }
});

router.post('/admin/:id/reject', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const log = await prisma.auditLog.findUnique({ where: { id: req.params.id } });
    if (!log || log.action !== 'UPGRADE_REQUEST') return res.status(404).json({ error: 'Cerere inexistentă' });
    const data = parseDetail(log.detail);
    if (data.status !== 'PENDING') return res.status(409).json({ error: 'Cererea nu mai e în așteptare.' });
    const reason = String(req.body.reason || '').trim() || 'Plata neconfirmată';
    const updated = { ...data, status: 'REJECTED', rejectedAt: new Date().toISOString(), rejectedBy: req.user.id, reason };
    await prisma.auditLog.update({
      where: { id: log.id },
      data: { detail: stringifyDetail(updated), status: 'WARNING' },
    });
    if (data.type === 'REGISTER') {
      await prisma.user.update({ where: { id: log.userId }, data: { blocked: false, plan: 'FREE' } });
    }
    res.json({ ok: true, message: 'Cerere respinsă.' });
  } catch (err) {
    console.error('[upgrade/admin/reject] error:', err);
    res.status(500).json({ error: 'Eroare server la respingere.' });
  }
});

export default router;
