import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getAppSettings, saveAppSettings } from '../utils/appSettings.js';
import { invalidateSettingsCache } from '../middleware/appSettings.js';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

function formatAuditType(type = '') {
  const value = String(type || '').toLowerCase();
  if (value.includes('auth')) return 'auth';
  if (value.includes('moder')) return 'moderare';
  if (value.includes('fin')) return 'finante';
  return 'setari';
}

function formatAuditStatus(status = '') {
  const value = String(status || '').toUpperCase();
  if (['SUCCESS', 'WARNING', 'ACTION', 'INFO'].includes(value)) return value;
  return 'INFO';
}

router.get('/overview', async (req, res) => {
  const [users, teams, posts, templates, workouts, pendingInvites, roleGroups, planGroups, contacts, professionalsRaw] = await Promise.all([
    prisma.user.count(),
    prisma.team.count(),
    prisma.post.count(),
    prisma.nutTemplate.count(),
    prisma.workout.count({ where: { status: { startsWith: 'TEMPLATE:' } } }),
    prisma.coachClient.count({ where: { status: 'PENDING' } }),
    prisma.user.groupBy({ by: ['role'], _count: true }),
    prisma.user.groupBy({ by: ['plan'], _count: true }),
    prisma.contactSubmission.count(),
    prisma.user.findMany({
      where: { role: { in: ['COACH', 'NUTRITIONIST'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        role: true,
        coachClients: { where: { status: 'ACCEPTED' }, select: { id: true } },
        nutClients: { where: { status: 'ACCEPTED' }, select: { id: true } },
      },
    }),
  ]);
  const roles = Object.fromEntries(roleGroups.map((row) => [row.role, row._count]));
  const plans = Object.fromEntries(planGroups.map((row) => [row.plan, row._count]));
  const professionals = professionalsRaw.map((professional) => {
    const clients = professional.role === 'COACH' ? professional.coachClients.length : professional.nutClients.length;
    const revenue = professional.role === 'COACH' ? clients * 149 : clients * 120;
    const commission = Math.round(revenue * 0.15);
    return {
      id: professional.id,
      name: professional.name,
      role: professional.role,
      clients,
      revenue,
      commission,
    };
  });
  const subscriptionRevenue = (plans.PRO || 0) * 49 + (plans.TEAM || 0) * 99;
  const serviceRevenue = professionals.reduce((sum, professional) => sum + professional.revenue, 0);
  const monthRevenue = subscriptionRevenue + serviceRevenue;
  res.json({
    kpis: {
      totalUsers: users,
      userCount: roles.USER || 0,
      coachCount: roles.COACH || 0,
      nutritionistCount: roles.NUTRITIONIST || 0,
      adminCount: roles.ADMIN || 0,
      teamsCount: teams,
      postsCount: posts,
      workoutCount: workouts,
      templateCount: templates,
      pendingInvites,
      publicLeads: contacts,
    },
    roles,
    plans,
    finance: {
      month: monthRevenue,
      year: monthRevenue * 12,
      profit: Math.round(monthRevenue * 0.72),
      subs: {
        free: plans.FREE || 0,
        pro: plans.PRO || 0,
        team: plans.TEAM || 0,
      },
      history: Array.from({ length: 6 }, (_, idx) => Math.max(0, Math.round(monthRevenue * (0.7 + idx * 0.06)))),
      professionals,
      commission: 15,
    },
  });
});

router.get('/users', async (req, res) => {
  const { q, role, limit } = req.query;
  const where = {};
  if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }];
  if (role) where.role = role;
  const users = await prisma.user.findMany({
    where,
    take: Number.parseInt(limit, 10) || 50,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      plan: true,
      streak: true,
      blocked: true,
      createdAt: true,
      teamMembers: { include: { team: { select: { name: true } } }, take: 1 },
    },
  });
  res.json({ total: users.length, users: users.map((user) => ({ ...user, teamName: user.teamMembers[0]?.team?.name || '', teamMembers: undefined })) });
});

router.patch('/users/:id/role', async (req, res) => {
  return res.status(403).json({ error: 'Schimbarea rolurilor este dezactivată din panoul admin.' });
});

router.delete('/users/:id', async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.patch('/users/:id/block', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  await prisma.user.update({ where: { id: req.params.id }, data: { blocked: !user.blocked } });
  res.json({ ok: true });
});

router.get('/inbox', async (req, res) => {
  const submissions = await prisma.contactSubmission.findMany({ orderBy: { createdAt: 'desc' } });
  const normalizeType = (type = '') => {
    const value = String(type || '').toLowerCase();
    if (value === 'contact') return 'contact';
    if (value.includes('early') || value.includes('wait') || value.includes('app')) return 'early-access';
    return 'contact';
  };
  const normalizeStatus = (status = '') => {
    const value = String(status || '').toLowerCase();
    if (value.includes('read') || value.includes('citit')) return 'citit';
    return 'nou';
  };
  res.json(submissions.map((item) => ({
    id: item.id,
    type: normalizeType(item.type),
    name: item.name || '—',
    email: item.email,
    subject: item.subject,
    message: item.message,
    date: new Date(item.createdAt).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    status: normalizeStatus(item.status),
    createdAt: item.createdAt,
  })));
});

// PATCH /admin/inbox/:id/read — marcheaza un mesaj ca citit
router.patch('/inbox/:id/read', async (req, res) => {
  try {
    const updated = await prisma.contactSubmission.update({
      where: { id: req.params.id },
      data: { status: 'citit' },
    });
    res.json({ ok: true, id: updated.id, status: updated.status });
  } catch (err) {
    console.error('[admin/inbox/read] error:', err);
    res.status(404).json({ error: 'Mesaj inexistent' });
  }
});

// POST /admin/inbox/mark-all-read — marcheaza toate mesajele ca citite
router.post('/inbox/mark-all-read', async (req, res) => {
  try {
    const result = await prisma.contactSubmission.updateMany({
      where: { status: { not: 'citit' } },
      data: { status: 'citit' },
    });
    res.json({ ok: true, markedRead: result.count });
  } catch (err) {
    console.error('[admin/inbox/mark-all-read] error:', err);
    res.status(500).json({ error: 'Eroare la marcare.' });
  }
});

router.get('/settings', async (req, res) => {
  const settings = await getAppSettings(prisma);
  res.json({ settings });
});

router.put('/settings', async (req, res) => {
  const settings = await saveAppSettings(prisma, req.body, req.user.id);
  invalidateSettingsCache(); // Force re-read on next request
  res.json({ ok: true, settings });
});

router.get('/audit', async (req, res) => {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: Number.parseInt(req.query.limit, 10) || 100,
    include: { user: { select: { email: true, name: true } } },
  });
  res.json(logs.map((log) => ({
    id: log.id,
    type: formatAuditType(log.type),
    status: formatAuditStatus(log.status),
    action: log.action,
    user: log.user?.email || log.user?.name || 'system',
    detail: log.detail,
    date: new Date(log.createdAt).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    createdAt: log.createdAt,
  })));
});

router.get('/system', async (req, res) => {
  const uptimeSec = Math.floor(process.uptime());
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const mem = process.memoryUsage();
  const memMB = Math.round(mem.rss / 1024 / 1024);
  const memPct = Math.min(100, Math.round((mem.heapUsed / mem.heapTotal) * 100));
  res.json({
    uptime: days > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`,
    memory: `${memMB}MB`,
    memoryPct: memPct,
    cpu: 'n/a',
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
  });
});

// === PASSWORD RESET — admin manual flow ===
//
// Cand un user apasa "Forgot password", auth.js creaza un AuditLog cu action='PASSWORD_RESET_REQUEST'.
// Admin vede aceste cereri si poate genera o parola temporara pentru user.
// Adminul transmite manual parola (prin DM, telefon, email extern).

// GET /admin/password-resets — toate cererile (rezolvate sau nu)
router.get('/password-resets', async (req, res) => {
  const requests = await prisma.auditLog.findMany({
    where: { action: 'PASSWORD_RESET_REQUEST' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { id: true, name: true, email: true, role: true, blocked: true } } },
  });

  const resolutions = await prisma.auditLog.findMany({
    where: { action: 'PASSWORD_RESET_DONE' },
    select: { userId: true, createdAt: true },
  });
  const resolvedMap = new Map();
  for (const row of resolutions) {
    if (!row.userId) continue;
    const existing = resolvedMap.get(row.userId);
    if (!existing || row.createdAt > existing) resolvedMap.set(row.userId, row.createdAt);
  }

  res.json(requests.map((req) => {
    const isResolved = req.userId && resolvedMap.has(req.userId) && resolvedMap.get(req.userId) > req.createdAt;
    return {
      id: req.id,
      userId: req.userId,
      user: req.user,
      requestedAt: req.createdAt,
      status: isResolved ? 'RESOLVED' : 'PENDING',
    };
  }));
});

// POST /admin/password-resets/:userId/generate
// Genereaza o parola temporara, o seteaza la user, si o returneaza la admin.
// Admin o copiaza si o trimite manual userului.
router.post('/password-resets/:userId/generate', async (req, res) => {
  const { userId } = req.params;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: 'Utilizator inexistent' });

  // Generare parola temporara — 8 caractere random + 2 cifre
  const generateTempPassword = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let pwd = '';
    for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd;
  };
  const tempPassword = generateTempPassword();
  const hashed = await bcrypt.hash(tempPassword, 12);

  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'PASSWORD_RESET_DONE',
      type: 'auth',
      status: 'SUCCESS',
      detail: JSON.stringify({ resolvedBy: req.user.id, email: user.email }),
    },
  });

  res.json({
    ok: true,
    tempPassword,
    user: { email: user.email, name: user.name },
  });
});

export default router;
