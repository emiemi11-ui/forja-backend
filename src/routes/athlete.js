import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';
import {
  exerciseById,
  foodById,
  parseSets,
  searchExercises,
  searchFood,
} from '../utils/catalogs.js';
import {
  athleteColor,
  ensureUserGoals,
  findExerciseByName,
  getDayWindow,
  getUserDailySummary,
  normalizeActiveSession,
  normalizeWorkoutExercise,
} from '../utils/userActivity.js';
import { safeJsonParse, writeMeta } from '../utils/metaStore.js';

const router = Router();
router.use(authenticate);

const MEAL_TYPE_MAP = {
  'mic dejun': 'Mic dejun',
  micdejun: 'Mic dejun',
  breakfast: 'Mic dejun',
  pranz: 'Pranz',
  lunch: 'Pranz',
  cina: 'Cina',
  dinner: 'Cina',
  gustare: 'Gustare',
  snack: 'Gustare',
};

function normalizeMealType(value) {
  const key = String(value || 'Gustare').trim().toLowerCase();
  return MEAL_TYPE_MAP[key] || value || 'Gustare';
}

function formatSleepResponse(entries) {
  if (entries.length === 0) {
    return {
      score: 0,
      hours: 0,
      bed: '--:--',
      wake: '--:--',
      bedTime: '--:--',
      wakeTime: '--:--',
      quality: 0,
      history: [],
      weekAvg: 0,
      consistencyScore: 0,
      recommendations: [],
    };
  }
  const latest = entries[0];
  return {
    score: latest.score,
    hours: latest.hours,
    bed: latest.bedTime,
    wake: latest.wakeTime,
    bedTime: latest.bedTime,
    wakeTime: latest.wakeTime,
    quality: latest.quality,
    history: entries.map((entry) => ({
      date: entry.date,
      hours: entry.hours,
      score: entry.score,
      bedTime: entry.bedTime,
      wakeTime: entry.wakeTime,
    })),
    weekAvg: entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0) / entries.length,
    consistencyScore: Math.max(0, Math.min(100, Math.round((entries.reduce((sum, entry) => sum + Number(entry.quality || 0), 0) / (entries.length * 5)) * 100))),
    recommendations: [],
  };
}

async function getPlannedWorkout(userId) {
  return prisma.workout.findFirst({
    where: { userId, status: { startsWith: 'PLAN:' } },
    include: { exercises: { orderBy: { order: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  });
}

async function ensurePlanWorkout(userId) {
  const existing = await getPlannedWorkout(userId);
  if (existing) return existing;
  return prisma.workout.create({
    data: { name: 'Planul meu', userId, status: 'PLAN:SELF' },
    include: { exercises: { orderBy: { order: 'asc' } } },
  });
}

function toExerciseCreateData(item, order) {
  const parsed = parseSets(item.sets);
  const repsValue = String(item.sets || '').toLowerCase().includes('s')
    ? Number(parsed.reps || 30)
    : Number(parsed.reps || 10);
  return {
    name: item.name,
    sets: Number(parsed.sets || 3),
    reps: repsValue,
    restSec: 90,
    order,
    done: false,
  };
}

async function getActiveWorkout(userId) {
  return prisma.workout.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { exercises: { orderBy: { order: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  });
}

function summarizeHistoryRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    exercises: row.exercises?.length || 0,
  }));
}

// Sleep
router.get('/sleep', async (req, res) => {
  const entries = await prisma.sleepEntry.findMany({
    where: { userId: req.user.id },
    orderBy: { date: 'desc' },
    take: 7,
  });
  res.json(formatSleepResponse(entries));
});

router.post('/sleep/log', async (req, res) => {
  const { bed, wake, quality } = req.body || {};
  if (!bed || !wake) return res.status(400).json({ error: 'Ora de culcare și trezire sunt obligatorii' });
  const start = new Date(`2000-01-01T${bed}`);
  const end = new Date(`2000-01-01T${wake}`);
  const diff = end >= start ? end - start : (end.getTime() + 24 * 3600000) - start.getTime();
  const hours = Number((diff / 3600000).toFixed(1));
  const score = Math.min(100, Math.round(hours * 12 + (Number(quality) || 3) * 4));
  const entry = await prisma.sleepEntry.create({
    data: {
      userId: req.user.id,
      bedTime: bed,
      wakeTime: wake,
      hours,
      quality: Number(quality) || 3,
      score,
    },
  });
  res.status(201).json(entry);
});

// Today summary
router.get('/today', async (req, res) => {
  const summary = await getUserDailySummary(prisma, req.user.id);
  res.json({
    water_cups: summary.waterCups,
    water_liters: summary.waterLiters,
    water_target_cups: summary.waterTargetCups,
    water_target_liters: summary.goals.water,
    steps: summary.steps,
    sleep_score: summary.sleepScore,
    sleep_hours: summary.sleepHours,
    kcal: summary.kcalToday,
    macros: summary.macros,
  });
});

router.post('/today/water', async (req, res) => {
  const cups = Math.max(0, Number(req.body?.cups || 0));
  const { start, end } = getDayWindow();
  await prisma.nutritionLog.deleteMany({
    where: { userId: req.user.id, date: { gte: start, lt: end }, mealType: 'WATER' },
  });
  if (cups > 0) {
    await prisma.nutritionLog.create({
      data: {
        userId: req.user.id,
        mealType: 'WATER',
        foodName: 'Apă',
        quantity: cups,
        kcal: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    });
  }
  res.json({ water_cups: cups, water_liters: Number((cups / 4).toFixed(1)) });
});

router.post('/today/steps', async (req, res) => {
  const steps = Math.max(0, Number(req.body?.steps || 0));
  await writeMeta(prisma, {
    userId: req.user.id,
    action: 'today_steps',
    type: 'today',
    detail: { steps },
    status: 'SUCCESS',
  });
  res.json({ steps });
});

// Nutrition
router.get('/meals', async (req, res) => {
  const summary = await getUserDailySummary(prisma, req.user.id);
  res.json(summary.meals);
});

router.post('/meals', async (req, res) => {
  const food = foodById(req.body?.foodId);
  if (!food) return res.status(404).json({ error: 'Aliment negăsit' });
  const mealType = normalizeMealType(req.body?.meal);
  const row = await prisma.nutritionLog.create({
    data: {
      userId: req.user.id,
      mealType,
      foodName: food.name,
      kcal: food.kcal,
      protein: food.p,
      carbs: food.c,
      fat: food.f,
      quantity: 1,
    },
  });
  res.status(201).json({
    id: row.id,
    meal: mealType,
    mealType,
    name: food.name,
    kcal: food.kcal,
    p: food.p,
    c: food.c,
    f: food.f,
    fib: food.fib,
    img: food.img,
    time: row.date,
  });
});

router.delete('/meals/:id', async (req, res) => {
  await prisma.nutritionLog.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  res.json({ ok: true });
});

router.get('/food', async (req, res) => {
  const q = String(req.query?.q || '').trim();
  res.json(searchFood({ q }).slice(0, 25));
});

router.post('/food/custom', async (req, res) => {
  // Custom foods are stored as entries in audit_log so users can see them
  // back via searchFood (no separate Food table in the schema).
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Completează denumirea alimentului.' });
  const quantity = String(req.body?.quantity || '1 porție').trim();
  const displayName = quantity ? `${name} (${quantity})` : name;
  const customFood = {
    id: `cf-${Date.now()}`,
    name: displayName,
    baseName: name,
    quantity,
    kcal: Number(req.body?.kcal || 0),
    p: Number(req.body?.p || req.body?.protein || 0),
    c: Number(req.body?.c || req.body?.carbs || 0),
    f: Number(req.body?.f || req.body?.fat || 0),
    fib: Number(req.body?.fib || 0),
    img: req.body?.img || '',
    recipe: req.body?.recipe || '',
    custom: true,
  };
  await writeMeta(prisma, {
    userId: req.user.id,
    action: `CUSTOM_FOOD:${customFood.id}`,
    type: 'food',
    detail: customFood,
    status: 'SUCCESS',
  });
  res.status(201).json(customFood);
});

// Exercises / Plan
router.get('/exercises', async (req, res) => {
  const workout = await ensurePlanWorkout(req.user.id);
  res.json((workout.exercises || []).map(normalizeWorkoutExercise));
});

router.get('/exercises/library', async (req, res) => {
  const q = String(req.query?.q || '').trim();
  const muscle = String(req.query?.muscle || '').trim();
  res.json(searchExercises({ q, muscle }));
});

router.post('/exercises', async (req, res) => {
  const item = exerciseById(req.body?.libId);
  if (!item) return res.status(404).json({ error: 'Exercițiu negăsit' });
  const workout = await ensurePlanWorkout(req.user.id);
  const duplicate = (workout.exercises || []).find((exercise) => exercise.name.toLowerCase() === item.name.toLowerCase());
  if (duplicate) return res.status(409).json({ error: 'Exercițiul este deja în plan' });
  const created = await prisma.workoutExercise.create({
    data: {
      workoutId: workout.id,
      ...toExerciseCreateData(item, (workout.exercises?.length || 0) + 1),
    },
  });
  res.status(201).json(normalizeWorkoutExercise(created));
});

router.patch('/exercises/bulk-done', async (req, res) => {
  const workout = await getPlannedWorkout(req.user.id);
  if (!workout) return res.json({ ok: true });
  await prisma.workoutExercise.updateMany({ where: { workoutId: workout.id }, data: { done: true } });
  res.json({ ok: true });
});

router.patch('/exercises/:id/toggle', async (req, res) => {
  const exercise = await prisma.workoutExercise.findFirst({
    where: { id: req.params.id, workout: { userId: req.user.id, status: { startsWith: 'PLAN:' } } },
  });
  if (!exercise) return res.status(404).json({ error: 'Exercițiu negăsit' });
  const updated = await prisma.workoutExercise.update({
    where: { id: exercise.id },
    data: { done: !exercise.done },
  });
  res.json(normalizeWorkoutExercise(updated));
});

router.delete('/exercises/:id', async (req, res) => {
  await prisma.workoutExercise.deleteMany({ where: { id: req.params.id, workout: { userId: req.user.id, status: { startsWith: 'PLAN:' } } } });
  res.json({ ok: true });
});

router.delete('/exercises', async (req, res) => {
  const workout = await getPlannedWorkout(req.user.id);
  if (workout) {
    await prisma.workoutExercise.deleteMany({ where: { workoutId: workout.id } });
  }
  res.json({ ok: true });
});

// Workout session
router.get('/workout/current', async (req, res) => {
  const activeWorkout = await getActiveWorkout(req.user.id);
  res.json({ session: activeWorkout ? normalizeActiveSession(activeWorkout) : null });
});

router.post('/workout/start', async (req, res) => {
  const existing = await getActiveWorkout(req.user.id);
  if (existing) return res.json({ session: normalizeActiveSession(existing) });

  const plan = await getPlannedWorkout(req.user.id);
  if (!plan || !plan.exercises?.length) {
    return res.status(400).json({ error: 'Nu ai exerciții în plan.' });
  }

  const active = await prisma.workout.create({
    data: {
      userId: req.user.id,
      name: plan.name || 'Antrenament activ',
      status: 'ACTIVE',
      exercises: {
        create: plan.exercises.map((exercise) => ({
          name: exercise.name,
          sets: exercise.sets,
          reps: exercise.reps,
          restSec: exercise.restSec,
          order: exercise.order,
          done: false,
          weight: 0,
          setsCompleted: 0,
        })),
      },
    },
    include: { exercises: { orderBy: { order: 'asc' } } },
  });

  res.status(201).json({ session: normalizeActiveSession(active) });
});

router.patch('/workout/current/set', async (req, res) => {
  const exerciseId = req.body?.exerciseId;
  const activeWorkout = await getActiveWorkout(req.user.id);
  if (!activeWorkout) return res.status(400).json({ error: 'Nicio sesiune activă' });
  const exercise = activeWorkout.exercises.find((item) => item.id === exerciseId);
  if (!exercise) return res.status(404).json({ error: 'Exercițiu negăsit în sesiune' });

  const setsTotal = Number(exercise.sets || 0);
  const currentCompleted = Number(exercise.setsCompleted || 0);
  const nextCompleted = Math.max(0, Math.min(setsTotal, currentCompleted + 1));
  const exerciseDone = setsTotal > 0 && nextCompleted >= setsTotal;

  await prisma.workoutExercise.update({
    where: { id: exercise.id },
    data: {
      setsCompleted: nextCompleted,
      done: exerciseDone,
    },
  });

  if (exerciseDone) {
    const planned = await getPlannedWorkout(req.user.id);
    const plannedExercise = planned?.exercises?.find((item) => item.name.toLowerCase() === exercise.name.toLowerCase());
    if (plannedExercise) {
      await prisma.workoutExercise.update({ where: { id: plannedExercise.id }, data: { done: true } });
    }
  }

  const refreshed = await getActiveWorkout(req.user.id);
  const session = normalizeActiveSession(refreshed);
  const totalSets = session.totalSets;
  const totalCompletedSets = session.completedSets;
  const totalCompletedExercises = session.completedExercises;
  const allDone = totalSets > 0 && totalCompletedSets >= totalSets;

  res.json({
    exerciseId,
    setsCompleted: nextCompleted,
    setsTotal,
    totalCompletedSets,
    totalCompletedExercises,
    exerciseDone,
    allDone,
  });
});

router.post('/workout/finish', async (req, res) => {
  const activeWorkout = await getActiveWorkout(req.user.id);
  if (!activeWorkout) return res.status(400).json({ error: 'Nicio sesiune activă' });

  const session = normalizeActiveSession(activeWorkout);
  const totalExercises = session.exercises.length;
  const totalSets = session.totalSets;
  const completedExercises = session.completedExercises;
  const completedSets = session.completedSets;
  const durationSeconds = session.elapsedSeconds;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const durationFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const xpEarned = Math.max(25, completedSets * 5 + completedExercises * 10);

  await prisma.workout.update({ where: { id: activeWorkout.id }, data: { status: 'COMPLETED' } });
  await prisma.user.update({
    where: { id: req.user.id },
    data: { xp: { increment: xpEarned }, streak: { increment: completedExercises > 0 ? 1 : 0 } },
  });

  res.json({
    allDone: totalSets > 0 && completedSets >= totalSets,
    completedExercises,
    totalExercises,
    completedSets,
    totalSets,
    xpEarned,
    durationFormatted,
  });
});

router.post('/workout/abandon', async (req, res) => {
  const activeWorkout = await getActiveWorkout(req.user.id);
  if (activeWorkout) {
    await prisma.workout.update({ where: { id: activeWorkout.id }, data: { status: 'ABANDONED' } });
  }
  res.json({ ok: true });
});

router.get('/workout/history', async (req, res) => {
  const workouts = await prisma.workout.findMany({
    where: { userId: req.user.id, status: { in: ['COMPLETED', 'ABANDONED'] } },
    include: { exercises: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json(summarizeHistoryRows(workouts));
});

// Discover (public marketplace)
router.get('/discover', async (req, res) => {
  const role = String(req.query?.role || '').trim().toUpperCase();
  const q = String(req.query?.q || '').trim();
  const where = {
    blocked: false,
    role: role && ['COACH', 'NUTRITIONIST'].includes(role)
      ? role
      : { in: ['COACH', 'NUTRITIONIST'] },
  };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { bio: { contains: q, mode: 'insensitive' } },
      { specialization: { contains: q, mode: 'insensitive' } },
    ];
  }

  const professionals = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      role: true,
      avatar: true,
      avatarUrl: true,
      bio: true,
      specialization: true,
      certifications: true,
      level: true,
      plan: true,
      teamMembers: {
        take: 1,
        orderBy: { joinedAt: 'asc' },
        select: { team: { select: { name: true } } },
      },
      coachClients: { where: { status: 'ACCEPTED' }, select: { id: true } },
      nutClients: { where: { status: 'ACCEPTED' }, select: { id: true } },
      posts: {
        where: { teamId: null },
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: {
          id: true,
          content: true,
          imageUrl: true,
          likes: true,
          createdAt: true,
          comments: {
            include: { author: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
    orderBy: [{ level: 'desc' }, { createdAt: 'asc' }],
    take: 50,
  });

  const reviewActions = professionals.map((person) => `REVIEW_FOR:${person.id}`);
  const reviewRows = reviewActions.length
    ? await prisma.auditLog.findMany({
        where: {
          type: 'review',
          action: { in: reviewActions },
        },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const reviewsByProfessional = reviewRows.reduce((acc, row) => {
    const professionalId = String(row.action || '').replace('REVIEW_FOR:', '');
    const payload = safeJsonParse(row.detail, {}) || {};
    const review = {
      user: payload.user || payload.userName || 'Utilizator',
      userId: payload.userId || row.userId || null,
      stars: Math.max(1, Math.min(5, Number(payload.stars) || 5)),
      text: payload.text || '',
      date: payload.date || row.createdAt?.toISOString?.().slice(0, 10),
    };
    if (!acc[professionalId]) acc[professionalId] = [];
    acc[professionalId].push(review);
    return acc;
  }, {});

  res.json(professionals.map((person) => {
    const reviews = reviewsByProfessional[person.id] || [];
    const rating = reviews.length
      ? Number((reviews.reduce((sum, review) => sum + Number(review.stars || 0), 0) / reviews.length).toFixed(1))
      : null;
    const benefits = String(person.certifications || '')
      .split(/\r?\n|[;,|]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 8);

    return {
      id: person.id,
      name: person.name,
      role: person.role,
      avatar: person.avatar || person.name.charAt(0).toUpperCase(),
      avatarUrl: person.avatarUrl,
      bio: person.bio,
      specialization: person.specialization,
      certifications: person.certifications,
      benefits,
      rating,
      reviews,
      level: person.level,
      plan: person.plan,
      teamName: person.teamMembers?.[0]?.team?.name || '',
      clientsCount: person.role === 'COACH' ? person.coachClients.length : person.nutClients.length,
      posts: person.posts.map((post) => ({
        id: post.id,
        content: post.content,
        img: post.imageUrl,
        likes: post.likes,
        createdAt: post.createdAt,
        comments: (post.comments || []).map((comment) => ({
          id: comment.id,
          author: comment.author.name,
          authorId: comment.author.id,
          text: comment.content,
          content: comment.content,
          createdAt: comment.createdAt,
        })),
      })),
    };
  }));
});

router.post('/discover/:id/reviews', async (req, res) => {
  const professional = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, role: true, blocked: true },
  });

  if (!professional || !['COACH', 'NUTRITIONIST'].includes(professional.role) || professional.blocked) {
    return res.status(404).json({ error: 'Profesionist inexistent' });
  }

  const stars = Math.max(1, Math.min(5, Number(req.body?.stars) || 5));
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Scrie un text pentru recenzie.' });

  const payload = {
    professionalId: professional.id,
    userId: req.user.id,
    user: req.user.name,
    stars,
    text,
    date: new Date().toISOString().slice(0, 10),
  };

  await writeMeta(prisma, {
    userId: req.user.id,
    action: `REVIEW_FOR:${professional.id}`,
    type: 'review',
    detail: payload,
    status: 'SUCCESS',
  });

  res.status(201).json(payload);
});

// Contact
router.post('/contact', async (req, res) => {
  const { name, email, subject, message, type } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Completează numele, emailul și mesajul.' });
  }
  await prisma.contactSubmission.create({
    data: {
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      subject: String(subject || 'contact').trim() || 'contact',
      message: String(message).trim(),
      type: String(type || 'contact').trim() || 'contact',
    },
  });
  res.json({ ok: true });
});

export default router;
