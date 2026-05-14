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

// POST /upgrade/request — utilizator existent cere upgrade plan
router.post('/request', authenticate, async (req, res) => {
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
    const payload = typeof existing.payload === 'object' ? existing.payload : {};
    if (payload.status === 'PENDING') {
      return res.status(409).json({ error: 'Ai deja o cerere de upgrade în așteptare.' });
    }
  }
  const amount = getPlanPrice(plan);
  const requestId = `UPG-${Date.now().toString(36).toUpperCase()}`;
  const log = await prisma.auditLog.create({
    data: {
      userId: req.user.id,
      action: 'UPGRADE_REQUEST',
      payload: {
        requestId, fromPlan: req.user.plan, toPlan: plan, email: userEmail,
        amount, iban: FORJA_IBAN, bank: FORJA_BANK, beneficiar: FORJA_BENEFICIAR,
        status: 'PENDING', type: 'UPGRADE',
      },
    },
  });
  res.json({
    ok: true, requestId, iban: FORJA_IBAN, bank: FORJA_BANK, beneficiar: FORJA_BENEFICIAR,
    amount, plan, email: userEmail, logId: log.id,
  });
});

// POST /upgrade/cancel — downgrade la FREE
router.post('/cancel', authenticate, async (req, res) => {
  if (req.user.plan === 'FREE') {
    return res.status(400).json({ error: 'Ești deja pe planul FREE.' });
  }
  await prisma.user.update({ where: { id: req.user.id }, data: { plan: 'FREE' } });
  await prisma.auditLog.create({
    data: {
      userId: req.user.id, action: 'PLAN_DOWNGRADE',
      payload: { from: req.user.plan, to: 'FREE', reason: 'user_cancellation' },
    },
  });
  res.json({ ok: true, message: 'Abonamentul a fost anulat. Ești acum pe planul FREE.' });
});

// GET /upgrade/my-request
router.get('/my-request', authenticate, async (req, res) => {
  const log = await prisma.auditLog.findFirst({
    where: { userId: req.user.id, action: 'UPGRADE_REQUEST' },
    orderBy: { createdAt: 'desc' },
  });
  if (!log) return res.json({ request: null });
  res.json({ request: { id: log.id, ...log.payload, createdAt: log.createdAt } });
});

// === ADMIN ===

router.get('/admin/list', authenticate, requireRole('ADMIN'), async (req, res) => {
  const logs = await prisma.auditLog.findMany({
    where: { action: 'UPGRADE_REQUEST' },
    orderBy: { createdAt: 'desc' }, take: 100,
  });
  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, plan: true, blocked: true },
  });
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    requests: logs.map(log => ({
      id: log.id, userId: log.userId, user: userMap[log.userId] || null,
      ...log.payload, createdAt: log.createdAt,
    })),
  });
});

router.post('/admin/:id/approve', authenticate, requireRole('ADMIN'), async (req, res) => {
  const log = await prisma.auditLog.findUnique({ where: { id: req.params.id } });
  if (!log || log.action !== 'UPGRADE_REQUEST') return res.status(404).json({ error: 'Cerere inexistentă' });
  const payload = typeof log.payload === 'object' ? log.payload : {};
  if (payload.status !== 'PENDING') return res.status(409).json({ error: 'Cererea nu mai e în așteptare.' });
  await prisma.user.update({
    where: { id: log.userId },
    data: { plan: payload.toPlan, blocked: false },
  });
  await prisma.auditLog.update({
    where: { id: log.id },
    data: { payload: { ...payload, status: 'APPROVED', approvedAt: new Date().toISOString(), approvedBy: req.user.id } },
  });
  await prisma.auditLog.create({
    data: { userId: log.userId, action: 'UPGRADE_APPROVED',
      payload: { requestId: payload.requestId, plan: payload.toPlan, approvedBy: req.user.email } },
  });
  global.__io?.to(`user:${log.userId}`).emit('upgrade:approved', { plan: payload.toPlan, requestId: payload.requestId });
  res.json({ ok: true, message: 'Cerere aprobată. User-ul are acum planul ' + payload.toPlan });
});

router.post('/admin/:id/reject', authenticate, requireRole('ADMIN'), async (req, res) => {
  const log = await prisma.auditLog.findUnique({ where: { id: req.params.id } });
  if (!log || log.action !== 'UPGRADE_REQUEST') return res.status(404).json({ error: 'Cerere inexistentă' });
  const payload = typeof log.payload === 'object' ? log.payload : {};
  if (payload.status !== 'PENDING') return res.status(409).json({ error: 'Cererea nu mai e în așteptare.' });
  const reason = String(req.body.reason || '').trim() || 'Plata neconfirmată';
  await prisma.auditLog.update({
    where: { id: log.id },
    data: { payload: { ...payload, status: 'REJECTED', rejectedAt: new Date().toISOString(), rejectedBy: req.user.id, reason } },
  });
  if (payload.type === 'REGISTER') {
    await prisma.user.update({ where: { id: log.userId }, data: { blocked: false, plan: 'FREE' } });
  }
  res.json({ ok: true, message: 'Cerere respinsă.' });
});

export default router;
