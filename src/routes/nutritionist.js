import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { readLatestMeta, writeMeta } from '../utils/metaStore.js';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(authenticate, requireRole('NUTRITIONIST', 'ADMIN'));

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function colorFromString(input = '') {
  const palette = ['#7B2FBE', '#1A52FF', '#15803D', '#FF4422', '#B45309', '#2563EB'];
  const sum = [...String(input)].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return palette[sum % palette.length];
}

async function getHydration(userId) {
  const since = startOfDay();
  const waterRows = await prisma.nutritionLog.findMany({ where: { userId, date: { gte: since }, mealType: 'WATER' } });
  return { waterCups: Math.round(waterRows.reduce((sum, row) => sum + Number(row.quantity || 1), 0)) };
}

async function getTemplateMeta(templateId, userId) {
  return readLatestMeta(prisma, { userId, action: `NUT_TEMPLATE_META:${templateId}` });
}

async function buildClientCard(link) {
  const client = link.client;
  const since = startOfDay();
  const [goals, meals, hydration] = await Promise.all([
    prisma.userGoals.findUnique({ where: { userId: client.id } }),
    prisma.nutritionLog.findMany({ where: { userId: client.id, date: { gte: since } } }),
    getHydration(client.id),
  ]);
  const kcalToday = meals.reduce((sum, meal) => sum + meal.kcal, 0);
  const target = goals?.kcal || link.template?.kcal || 2200;
  const compliance = target ? Math.min(120, Math.round((kcalToday / target) * 100)) : 0;
  return {
    id: client.id,
    name: client.name,
    av: client.avatar || client.name?.[0] || 'C',
    col: colorFromString(client.id),
    avatarUrl: client.avatarUrl,
    notes: client.bio || client.goal || '',
    goal: client.goal || '',
    kcal_today: kcalToday,
    kcal_target: target,
    compliance,
    last: new Date(link.createdAt).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' }),
    linked: link.status === 'ACCEPTED',
    journal: client.bio ? [{ text: client.bio, date: new Date(link.createdAt).toISOString().slice(0, 10) }] : [],
    waterCups: hydration.waterCups,
    templateId: link.templateId,
  };
}

router.get('/overview', async (req, res) => {
  const [clients, templates] = await Promise.all([
    prisma.nutClient.count({ where: { nutritionistId: req.user.id, status: { in: ['ACCEPTED', 'PENDING'] } } }),
    prisma.nutTemplate.count({ where: { authorId: req.user.id } }),
  ]);
  res.json({
    nutritionistName: req.user.name,
    total_clients: clients,
    active_today: clients,
    avg_compliance: 0,
    plans_created: templates,
    revenue: clients * 120,
    hero: { name: req.user.name },
    kpis: { clients, templates, revenue: clients * 120 },
    complianceChart: [],
    revenueChart: [],
    clients: [],
    templates: [],
  });
});

router.get('/clients', async (req, res) => {
  const clients = await prisma.nutClient.findMany({
    where: { nutritionistId: req.user.id },
    include: { client: true, template: true },
    orderBy: { createdAt: 'desc' },
  });
  const payload = await Promise.all(clients.map(buildClientCard));
  res.json(payload);
});

router.get('/clients/:id', async (req, res) => {
  const link = await prisma.nutClient.findUnique({
    where: { nutritionistId_clientId: { nutritionistId: req.user.id, clientId: req.params.id } },
    include: { client: true, template: true },
  });
  if (!link) return res.status(404).json({ error: 'Client inexistent' });
  const card = await buildClientCard(link);
  const since = startOfDay();
  const [goals, meals, hydration] = await Promise.all([
    prisma.userGoals.findUnique({ where: { userId: link.client.id } }),
    prisma.nutritionLog.findMany({ where: { userId: link.client.id, date: { gte: since } }, orderBy: { date: 'asc' } }),
    getHydration(link.client.id),
  ]);
  const macros = meals.reduce((acc, meal) => ({
    kcal: acc.kcal + meal.kcal,
    p: acc.p + Number(meal.protein || 0),
    c: acc.c + Number(meal.carbs || 0),
    f: acc.f + Number(meal.fat || 0),
  }), { kcal: 0, p: 0, c: 0, f: 0 });
  res.json({
    ...card,
    meals: meals.map((meal) => ({ id: meal.id, type: meal.mealType, items: meal.foodName, kcal: meal.kcal })),
    realData: {
      kcalToday: macros.kcal,
      weight: link.client.weight || 0,
      macros,
      waterCups: hydration.waterCups,
      kcalTarget: goals?.kcal || link.template?.kcal || 2200,
    },
  });
});

router.post('/clients/invite', async (req, res) => {
  const { email } = req.body;
  const client = await prisma.user.findUnique({ where: { email } });
  if (!client) return res.status(404).json({ error: 'Utilizator inexistent' });
  if (client.id === req.user.id) return res.status(400).json({ error: 'Nu te poti adauga pe tine' });

  const link = await prisma.nutClient.upsert({
    where: { nutritionistId_clientId: { nutritionistId: req.user.id, clientId: client.id } },
    create: { nutritionistId: req.user.id, clientId: client.id, status: 'PENDING_CLIENT' },
    update: { status: 'PENDING_CLIENT' },
  });
  global.__io?.to(`user:${client.id}`).emit('professional:invite', {
    type: 'NUTRITIONIST',
    linkId: link.id,
    from: { id: req.user.id, name: req.user.name },
  });
  res.json({ ok: true, linkId: link.id });
});

// GET /api/nutritionist/requests - cereri primite de la clienti
router.get('/requests', async (req, res) => {
  const requests = await prisma.nutClient.findMany({
    where: { nutritionistId: req.user.id, status: 'PENDING' },
    include: {
      client: { select: { id: true, name: true, email: true, avatar: true, avatarUrl: true, goal: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(requests.map((r) => ({
    linkId: r.id,
    client: r.client,
    requestedAt: r.createdAt,
  })));
});

// POST /api/nutritionist/requests/:linkId/accept
router.post('/requests/:linkId/accept', async (req, res) => {
  const link = await prisma.nutClient.findUnique({ where: { id: req.params.linkId } });
  if (!link || link.nutritionistId !== req.user.id) {
    return res.status(404).json({ error: 'Cerere inexistenta' });
  }
  const updated = await prisma.nutClient.update({
    where: { id: link.id },
    data: { status: 'ACCEPTED' },
  });
  global.__io?.to(`user:${link.clientId}`).emit('professional:request:accepted', {
    type: 'NUTRITIONIST',
    linkId: link.id,
    nutritionist: { id: req.user.id, name: req.user.name },
  });
  res.json({ ok: true, status: updated.status });
});

// POST /api/nutritionist/requests/:linkId/reject
router.post('/requests/:linkId/reject', async (req, res) => {
  const link = await prisma.nutClient.findUnique({ where: { id: req.params.linkId } });
  if (!link || link.nutritionistId !== req.user.id) {
    return res.status(404).json({ error: 'Cerere inexistenta' });
  }
  await prisma.nutClient.delete({ where: { id: link.id } });
  global.__io?.to(`user:${link.clientId}`).emit('professional:request:rejected', {
    type: 'NUTRITIONIST',
    linkId: link.id,
  });
  res.json({ ok: true });
});

router.get('/templates', async (req, res) => {
  const templates = await prisma.nutTemplate.findMany({
    where: { authorId: req.user.id },
    include: { clients: true },
    orderBy: { createdAt: 'desc' },
  });
  const payload = await Promise.all(templates.map(async (template) => {
    const meta = await getTemplateMeta(template.id, req.user.id);
    return {
      id: template.id,
      name: template.name,
      kcal: template.kcal,
      protein: template.protein,
      carbs: template.carbs,
      fat: template.fat,
      p: template.protein,
      c: template.carbs,
      f: template.fat,
      clients: template.clients.length,
      mealPlan: Array.isArray(meta?.mealPlan) ? meta.mealPlan : [],
      description: meta?.description || '',
      createdAt: template.createdAt,
    };
  }));
  res.json(payload);
});

router.post('/templates', async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Numele template-ului este obligatoriu' });
  const kcal = Number(req.body.kcal || 0);
  const protein = Number(req.body.protein || req.body.p || 0);
  const carbs = Number(req.body.carbs || req.body.c || 0);
  const fat = Number(req.body.fat || req.body.f || 0);
  const template = await prisma.nutTemplate.create({
    data: { name, kcal, protein, carbs, fat, authorId: req.user.id },
  });
  await writeMeta(prisma, {
    userId: req.user.id,
    action: `NUT_TEMPLATE_META:${template.id}`,
    type: 'nutrition-template',
    status: 'ACTION',
    detail: { mealPlan: Array.isArray(req.body.mealPlan) ? req.body.mealPlan : [], description: req.body.description || '' },
  });
  res.status(201).json({
    id: template.id,
    name: template.name,
    kcal: template.kcal,
    p: template.protein,
    c: template.carbs,
    f: template.fat,
    mealPlan: Array.isArray(req.body.mealPlan) ? req.body.mealPlan : [],
  });
});

router.post('/templates/:id/apply', async (req, res) => {
  const template = await prisma.nutTemplate.findFirst({ where: { id: req.params.id, authorId: req.user.id } });
  if (!template) return res.status(404).json({ error: 'Template inexistent' });
  const clientIds = Array.isArray(req.body.clientIds) ? req.body.clientIds : [];
  if (!clientIds.length) return res.status(400).json({ error: 'Selectează clienți' });
  await Promise.all(clientIds.map((clientId) => prisma.nutClient.upsert({
    where: { nutritionistId_clientId: { nutritionistId: req.user.id, clientId } },
    create: { nutritionistId: req.user.id, clientId, status: 'ACCEPTED', templateId: template.id },
    update: { status: 'ACCEPTED', templateId: template.id },
  })));
  res.json({ ok: true });
});

export default router;
