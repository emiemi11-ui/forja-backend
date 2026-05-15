import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { requirePro } from '../middleware/planCheck.js';
import { ensureUserGoals, getUserDailySummary, normalizeWorkoutExercise } from '../utils/userActivity.js';
import { readLatestMeta, writeMeta } from '../utils/metaStore.js';
import prisma from '../lib/prisma.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(authenticate);

async function getSafeUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      plan: true,
      avatar: true,
      avatarUrl: true,
      bio: true,
      specialization: true,
      certifications: true,
      goal: true,
      weight: true,
      height: true,
      level: true,
      xp: true,
      streak: true,
      blocked: true,
      createdAt: true,
      teamMembers: {
        take: 1,
        orderBy: { joinedAt: 'asc' },
        select: { team: { select: { id: true, name: true } } },
      },
    },
  });
  if (!user) return null;
  return {
    ...user,
    teamName: user.teamMembers?.[0]?.team?.name || '',
    teamId: user.teamMembers?.[0]?.team?.id || null,
    teamMembers: undefined,
  };
}

// GET /user — current user profile
router.get('/', async (req, res) => {
  const safeUser = await getSafeUser(req.user.id);
  if (!safeUser) return res.status(404).json({ error: 'Utilizator inexistent' });
  res.json(safeUser);
});

// PATCH /user — update profile
router.patch('/', async (req, res) => {
  const allowed = ['name', 'bio', 'specialization', 'certifications', 'goal', 'weight', 'height', 'avatarUrl'];
  const data = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }

  // Email este special - verificam unicitate
  if (req.body.email !== undefined) {
    const newEmail = String(req.body.email || '').trim().toLowerCase();
    if (!newEmail || !newEmail.includes('@') || newEmail.length < 5) {
      return res.status(400).json({ error: 'Email invalid.' });
    }
    if (newEmail !== (req.user.email || '').toLowerCase()) {
      const existing = await prisma.user.findFirst({ where: { email: newEmail, NOT: { id: req.user.id } } });
      if (existing) return res.status(409).json({ error: 'Email-ul este deja folosit de alt cont.' });
      data.email = newEmail;
    }
  }

  if (data.name) data.avatar = String(data.name).trim().charAt(0).toUpperCase() || 'U';
  await prisma.user.update({ where: { id: req.user.id }, data });
  const safeUser = await getSafeUser(req.user.id);
  res.json(safeUser);
});

// POST /user/avatar — upload avatar as data URL
router.post('/avatar', upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fișier lipsă' });
  const mime = req.file.mimetype || 'image/png';
  const avatarUrl = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
  await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl } });
  res.json({ avatarUrl });
});

// GET /goals
router.get('/goals', async (req, res) => {
  const goals = await ensureUserGoals(prisma, req.user.id);
  res.json(goals);
});

// PUT /goals
router.put('/goals', async (req, res) => {
  const {
    kcal,
    protein,
    carbs,
    fat,
    water,
    steps,
    sleep,
    weightTarget,
  } = req.body || {};

  const baseData = {
    ...(kcal !== undefined ? { kcal: Number(kcal) || 0 } : {}),
    ...(protein !== undefined ? { protein: Number(protein) || 0 } : {}),
    ...(carbs !== undefined ? { carbs: Number(carbs) || 0 } : {}),
    ...(fat !== undefined ? { fat: Number(fat) || 0 } : {}),
    ...(water !== undefined ? { water: Number(water) || 0 } : {}),
    ...(steps !== undefined ? { steps: Number(steps) || 0 } : {}),
    ...(sleep !== undefined ? { sleep: Number(sleep) || 0 } : {}),
  };

  await prisma.userGoals.upsert({
    where: { userId: req.user.id },
    create: { userId: req.user.id, ...baseData },
    update: baseData,
  });

  if (weightTarget !== undefined) {
    await writeMeta(prisma, {
      userId: req.user.id,
      action: 'goal_weight_target',
      type: 'goals',
      detail: { weightTarget: Number(weightTarget) || 0 },
      status: 'SUCCESS',
    });
  }

  const goals = await ensureUserGoals(prisma, req.user.id);
  res.json(goals);
});

// GET /dashboard — overview data shaped for current frontend
router.get('/dashboard', async (req, res) => {
  const [safeUser, summary, coachLink, nutritionLink, coachPlanWorkout, selfPlanWorkout] = await Promise.all([
    getSafeUser(req.user.id),
    getUserDailySummary(prisma, req.user.id),
    prisma.coachClient.findFirst({
      where: { athleteId: req.user.id, status: 'ACCEPTED' },
      include: { coach: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.nutClient.findFirst({
      where: { clientId: req.user.id, status: { in: ['ACCEPTED', 'PENDING'] } },
      include: {
        nutritionist: { select: { id: true, name: true } },
        template: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.workout.findFirst({
      where: { userId: req.user.id, status: { startsWith: 'COACH:' } },
      include: { exercises: { orderBy: { order: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.workout.findFirst({
      where: { userId: req.user.id, status: { startsWith: 'PLAN:' } },
      include: { exercises: { orderBy: { order: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  if (!safeUser) return res.status(404).json({ error: 'Utilizator inexistent' });

  const nutritionMeta = nutritionLink?.templateId
    ? await readLatestMeta(prisma, {
        userId: nutritionLink.nutritionistId,
        action: `NUT_TEMPLATE_META:${nutritionLink.templateId}`,
      })
    : null;

  // Pentru MyPlansPage: pastram backward-compat (assignedWorkoutPlan = coach plan, daca exista),
  // dar adaugam si lista plans care contine si planul propriu, daca exista.
  const planWorkout = coachPlanWorkout || selfPlanWorkout;

  const buildPlanSummary = (workout, isCoachPlan) => workout ? {
    id: workout.id,
    name: workout.name,
    coachName: isCoachPlan ? (coachLink?.coach?.name || '') : '',
    category: isCoachPlan ? 'Asignat de coach' : 'Plan personal',
    exercises: workout.exercises.length,
    assignedAt: (workout.updatedAt || workout.createdAt)?.toISOString?.() || null,
    status: 'active',
    active: !String(workout.status || '').endsWith(':INACTIVE'),  // ← NOU
    items: workout.exercises.map(normalizeWorkoutExercise),
    isCoachPlan,
  } : null;

  const assignedWorkoutPlan = buildPlanSummary(planWorkout, Boolean(coachPlanWorkout));

  // Lista cu toate planurile user-ului (coach + propriu) — pentru MyPlansPage
  const workoutPlans = [
    buildPlanSummary(coachPlanWorkout, true),
    buildPlanSummary(selfPlanWorkout, false),
  ].filter(Boolean);

  const assignedNutritionPlan = nutritionLink?.template ? {
    id: nutritionLink.template.id,
    name: nutritionLink.template.name,
    nutritionist: nutritionLink.nutritionist?.name || '',
    kcal: nutritionLink.template.kcal,
    p: nutritionLink.template.protein,
    c: nutritionLink.template.carbs,
    f: nutritionLink.template.fat,
    assignedAt: (nutritionLink.createdAt)?.toISOString?.() || null,
    status: nutritionLink.status === 'ACCEPTED' ? 'active' : 'pending',
    meals: Array.isArray(nutritionMeta?.mealPlan) ? nutritionMeta.mealPlan : [],
  } : null;

  res.json({
    user: safeUser,
    goals: summary.goals,
    today: {
      water_cups: summary.waterCups,
      steps: summary.steps,
      sleep_score: summary.sleepScore,
      sleep_hours: summary.sleepHours,
      waterTargetLiters: summary.goals.water,
      waterTargetCups: summary.waterTargetCups,
      waterLiters: summary.waterLiters,
      kcal: summary.kcalToday,
    },
    workout: {
      name: summary.exercisesTotal ? 'PLANUL ZILEI' : 'RECOVERY / MOBILITY',
      day: 1,
      week: 1,
      exercisesTotal: summary.exercisesTotal,
      exercisesDone: summary.exercisesDone,
      exercises_total: summary.exercisesTotal,
      exercises_done: summary.exercisesDone,
      progressPct: summary.progressPct,
      progress_pct: summary.progressPct,
    },
    macros: {
      kcal: summary.macros.kcal,
      p: summary.macros.p,
      c: summary.macros.c,
      f: summary.macros.f,
      fib: summary.macros.fib,
      target: summary.kcalTarget,
    },
    exercises: summary.exercises,
    assignedWorkoutPlan,
    workoutPlans,
    assignedNutritionPlan,
  });
});

// ============================================================================
// PROFESSIONAL RELATIONSHIPS (athlete <-> coach / nutritionist)
// ============================================================================

// GET /api/user/professionals
// Returneaza coach-ii si nutritionistii curentului user (atletul)
router.get('/professionals', async (req, res) => {
  const [coachLinks, nutLinks] = await Promise.all([
    prisma.coachClient.findMany({
      where: { athleteId: req.user.id },
      include: {
        coach: {
          select: { id: true, name: true, email: true, avatar: true, avatarUrl: true, specialization: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.nutClient.findMany({
      where: { clientId: req.user.id },
      include: {
        nutritionist: {
          select: { id: true, name: true, email: true, avatar: true, avatarUrl: true, specialization: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.json({
    coaches: coachLinks.map((link) => ({
      linkId: link.id,
      status: link.status,
      since: link.createdAt,
      professional: link.coach,
      type: 'COACH',
    })),
    nutritionists: nutLinks.map((link) => ({
      linkId: link.id,
      status: link.status,
      since: link.createdAt,
      professional: link.nutritionist,
      type: 'NUTRITIONIST',
    })),
  });
});

// POST /api/user/professionals/request
// Atletul cere unui profesionist sa fie coach sau nutritionist
// Necesita planul PRO sau TEAM
router.post('/professionals/request', requirePro, async (req, res) => {
  const { professionalId } = req.body || {};
  if (!professionalId) return res.status(400).json({ error: 'professionalId lipseste' });
  if (professionalId === req.user.id) return res.status(400).json({ error: 'Nu te poti adauga pe tine' });

  const professional = await prisma.user.findUnique({
    where: { id: professionalId },
    select: { id: true, role: true, name: true },
  });
  if (!professional) return res.status(404).json({ error: 'Profesionist inexistent' });

  if (professional.role === 'COACH') {
    const link = await prisma.coachClient.upsert({
      where: { coachId_athleteId: { coachId: professional.id, athleteId: req.user.id } },
      create: { coachId: professional.id, athleteId: req.user.id, status: 'PENDING', notes: 'Cerere de la atlet' },
      update: {}, // daca exista deja, nu suprascriu nimic (pastrez statusul actual)
    });
    // Notifica coach-ul prin Socket.IO
    global.__io?.to(`user:${professional.id}`).emit('professional:request', {
      type: 'COACH',
      linkId: link.id,
      from: { id: req.user.id, name: req.user.name },
    });
    return res.json({ ok: true, linkId: link.id, status: link.status, type: 'COACH' });
  }

  if (professional.role === 'NUTRITIONIST') {
    const link = await prisma.nutClient.upsert({
      where: { nutritionistId_clientId: { nutritionistId: professional.id, clientId: req.user.id } },
      create: { nutritionistId: professional.id, clientId: req.user.id, status: 'PENDING' },
      update: {},
    });
    global.__io?.to(`user:${professional.id}`).emit('professional:request', {
      type: 'NUTRITIONIST',
      linkId: link.id,
      from: { id: req.user.id, name: req.user.name },
    });
    return res.json({ ok: true, linkId: link.id, status: link.status, type: 'NUTRITIONIST' });
  }

  return res.status(400).json({ error: 'Userul selectat nu e coach sau nutritionist' });
});

// DELETE /api/user/professionals/:type/:linkId
// Atletul anuleaza cererea sau se desfasoara de profesionist
router.delete('/professionals/:type/:linkId', async (req, res) => {
  const { type, linkId } = req.params;

  if (type === 'COACH') {
    const link = await prisma.coachClient.findUnique({ where: { id: linkId } });
    if (!link || link.athleteId !== req.user.id) {
      return res.status(404).json({ error: 'Legatura inexistenta' });
    }
    await prisma.coachClient.delete({ where: { id: linkId } });
    global.__io?.to(`user:${link.coachId}`).emit('professional:link:removed', { linkId, by: req.user.id });
    return res.json({ ok: true });
  }

  if (type === 'NUTRITIONIST') {
    const link = await prisma.nutClient.findUnique({ where: { id: linkId } });
    if (!link || link.clientId !== req.user.id) {
      return res.status(404).json({ error: 'Legatura inexistenta' });
    }
    await prisma.nutClient.delete({ where: { id: linkId } });
    global.__io?.to(`user:${link.nutritionistId}`).emit('professional:link:removed', { linkId, by: req.user.id });
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Tip necunoscut (asteptat COACH sau NUTRITIONIST)' });
});

// POST /api/user/professionals/:type/:linkId/accept
// Atletul accepta invitatia primita de la un coach/nutritionist
router.post('/professionals/:type/:linkId/accept', async (req, res) => {
  const { type, linkId } = req.params;

  if (type === 'COACH') {
    const link = await prisma.coachClient.findUnique({ where: { id: linkId } });
    if (!link || link.athleteId !== req.user.id) {
      return res.status(404).json({ error: 'Invitatie inexistenta' });
    }
    if (link.status !== 'PENDING_ATHLETE') {
      return res.status(400).json({ error: 'Invitatia nu mai este in asteptare' });
    }
    const updated = await prisma.coachClient.update({
      where: { id: linkId },
      data: { status: 'ACCEPTED' },
    });
    global.__io?.to(`user:${link.coachId}`).emit('professional:invite:accepted', {
      linkId,
      athlete: { id: req.user.id, name: req.user.name },
    });
    return res.json({ ok: true, status: updated.status });
  }

  if (type === 'NUTRITIONIST') {
    const link = await prisma.nutClient.findUnique({ where: { id: linkId } });
    if (!link || link.clientId !== req.user.id) {
      return res.status(404).json({ error: 'Invitatie inexistenta' });
    }
    if (link.status !== 'PENDING_CLIENT') {
      return res.status(400).json({ error: 'Invitatia nu mai este in asteptare' });
    }
    const updated = await prisma.nutClient.update({
      where: { id: linkId },
      data: { status: 'ACCEPTED' },
    });
    global.__io?.to(`user:${link.nutritionistId}`).emit('professional:invite:accepted', {
      linkId,
      client: { id: req.user.id, name: req.user.name },
    });
    return res.json({ ok: true, status: updated.status });
  }

  return res.status(400).json({ error: 'Tip necunoscut (asteptat COACH sau NUTRITIONIST)' });
});

// POST /api/user/professionals/:type/:linkId/reject
// Atletul refuza invitatia (sterge link-ul)
router.post('/professionals/:type/:linkId/reject', async (req, res) => {
  const { type, linkId } = req.params;

  if (type === 'COACH') {
    const link = await prisma.coachClient.findUnique({ where: { id: linkId } });
    if (!link || link.athleteId !== req.user.id) {
      return res.status(404).json({ error: 'Invitatie inexistenta' });
    }
    await prisma.coachClient.delete({ where: { id: linkId } });
    global.__io?.to(`user:${link.coachId}`).emit('professional:invite:rejected', {
      linkId,
      by: req.user.id,
    });
    return res.json({ ok: true });
  }

  if (type === 'NUTRITIONIST') {
    const link = await prisma.nutClient.findUnique({ where: { id: linkId } });
    if (!link || link.clientId !== req.user.id) {
      return res.status(404).json({ error: 'Invitatie inexistenta' });
    }
    await prisma.nutClient.delete({ where: { id: linkId } });
    global.__io?.to(`user:${link.nutritionistId}`).emit('professional:invite:rejected', {
      linkId,
      by: req.user.id,
    });
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Tip necunoscut (asteptat COACH sau NUTRITIONIST)' });
});

export default router;
