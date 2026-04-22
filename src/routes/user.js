import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
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
  const [safeUser, summary, coachLink, nutritionLink, planWorkout] = await Promise.all([
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

  const assignedWorkoutPlan = planWorkout ? {
    id: planWorkout.id,
    name: planWorkout.name,
    coachName: coachLink?.coach?.name || '',
    category: coachLink ? 'Asignat de coach' : 'Plan personal',
    exercises: planWorkout.exercises.length,
    assignedAt: (coachLink?.createdAt || planWorkout.updatedAt || planWorkout.createdAt)?.toISOString?.() || null,
    status: 'active',
    items: planWorkout.exercises.map(normalizeWorkoutExercise),
  } : null;

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
    assignedNutritionPlan,
  });
});

export default router;
