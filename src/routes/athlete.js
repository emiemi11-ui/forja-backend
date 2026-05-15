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
  // Doar planul user-ului propriu (PLAN:*), NU planul atribuit de coach (COACH:*)
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
  return rows.map((row) => {
    const exercises = row.exercises || [];
    const totalSets = exercises.reduce((sum, ex) => sum + Number(ex.sets || 0), 0);
    const completedSets = exercises.reduce((sum, ex) => sum + Math.min(Number(ex.sets || 0), Number(ex.setsCompleted || 0)), 0);
    const completedExercises = exercises.filter((ex) => Number(ex.setsCompleted || 0) >= Number(ex.sets || 0) && Number(ex.sets || 0) > 0).length;
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
      exercises: exercises.length,
      exercisesCompleted: completedExercises,
      totalSets,
      completedSets,
      exerciseDetails: exercises.map((ex) => ({
        name: ex.name,
        setsCompleted: Number(ex.setsCompleted || 0),
        setsTotal: Number(ex.sets || 0),
        done: !!ex.done,
      })),
    };
  });
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
  // Read user's water goal (in liters) to compute max cups (4 cups per liter)
  const userGoals = await prisma.userGoals.findUnique({ where: { userId: req.user.id } });
  const targetLiters = Number(userGoals?.water || 3);
  const maxCups = Math.max(4, Math.round(targetLiters * 4));

  // Clamp incoming cups between 0 and maxCups
  const requested = Math.max(0, Number(req.body?.cups || 0));
  const cups = Math.min(requested, maxCups);

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
  res.json({
    water_cups: cups,
    water_liters: Number((cups / 4).toFixed(1)),
    water_target_cups: maxCups,
    water_target_liters: targetLiters,
  });
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
  const foodId = String(req.body?.foodId || '');
  let food = foodById(foodId);
  // Daca nu e in catalog, cauta in audit log (custom foods)
  if (!food && foodId.startsWith('cf-')) {
    const log = await prisma.auditLog.findFirst({
      where: { userId: req.user.id, action: `CUSTOM_FOOD:${foodId}` },
      orderBy: { createdAt: 'desc' },
    });
    if (log) {
      let data;
      try { data = typeof log.detail === 'string' ? JSON.parse(log.detail) : (log.detail || log.payload || {}); }
      catch { data = {}; }
      food = {
        id: data.id, name: data.name,
        kcal: Number(data.kcal) || 0,
        p: Number(data.p) || 0,
        c: Number(data.c) || 0,
        f: Number(data.f) || 0,
        fib: Number(data.fib) || 0,
        img: data.img || '',  // FIX: pastreaza imaginea custom uploaded
      };
    }
  }
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
  // Static foods + user's custom foods
  const staticFoods = searchFood({ q }).slice(0, 25);
  // Custom foods stored as auditLog with action starting CUSTOM_FOOD:
  const customLogs = await prisma.auditLog.findMany({
    where: { userId: req.user.id, action: { startsWith: 'CUSTOM_FOOD:' } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const customFoods = customLogs
    .map(l => {
      try { return typeof l.detail === 'string' ? JSON.parse(l.detail) : (l.detail || l.payload || {}); }
      catch { return {}; }
    })
    .filter(f => f && f.id && (!q || (f.name || '').toLowerCase().includes(q.toLowerCase())));
  // User's custom foods first
  res.json([...customFoods, ...staticFoods].slice(0, 30));
});

router.post('/food/custom', async (req, res) => {
  // Custom foods are stored as entries in audit_log so users can see them
  // back via searchFood (no separate Food table in the schema).
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Completează denumirea alimentului.' });
  const quantity = String(req.body?.quantity || '1 porție').trim();
  const displayName = quantity ? `${name} (${quantity})` : name;
  const imgValue = req.body?.img || '';
  console.log('[food/custom] CREATE', {
    name: displayName,
    hasImg: !!imgValue,
    imgLength: imgValue.length,
    imgStart: imgValue.substring(0, 50),
  });
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
    img: imgValue,
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
  console.log('[food/custom] SAVED to auditLog, returning to client');
  res.status(201).json(customFood);
});

// Exercises / Plan
router.get('/exercises', async (req, res) => {
  const workout = await ensurePlanWorkout(req.user.id);
  res.json((workout.exercises || []).map(normalizeWorkoutExercise));
});

// GET /coach-plan — returneaza planul atribuit de coach (separat de planul propriu)
router.get('/coach-plan', async (req, res) => {
  const coachWorkout = await prisma.workout.findFirst({
    where: { userId: req.user.id, status: { startsWith: 'COACH:' } },
    include: { exercises: { orderBy: { order: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  });
  if (!coachWorkout) return res.json({ plan: null });
  // Cauta numele coach-ului
  const coachLink = await prisma.coachClient.findFirst({
    where: { athleteId: req.user.id, status: 'ACCEPTED' },
    include: { coach: { select: { name: true } } },
  });
  res.json({
    plan: {
      id: coachWorkout.id,
      name: coachWorkout.name,
      coachName: coachLink?.coach?.name || 'Coach',
      active: !String(coachWorkout.status || '').endsWith(':INACTIVE'),  // ← NOU
      exercises: (coachWorkout.exercises || []).map(normalizeWorkoutExercise),
    },
  });
});

// Toggle activare/dezactivare plan (own sau coach)
// Adaugă/scoate suffix `:INACTIVE` în status
router.patch('/workouts/:id/toggle-active', async (req, res) => {
  const workout = await prisma.workout.findFirst({
    where: {
      id: req.params.id,
      userId: req.user.id,
      OR: [
        { status: { startsWith: 'PLAN:' } },
        { status: { startsWith: 'COACH:' } },
      ],
    },
  });
  if (!workout) return res.status(404).json({ error: 'Plan negăsit' });
  const currentStatus = String(workout.status || '');
  const isInactive = currentStatus.endsWith(':INACTIVE');
  const newStatus = isInactive
    ? currentStatus.replace(/:INACTIVE$/, '')
    : `${currentStatus}:INACTIVE`;
  await prisma.workout.update({ where: { id: workout.id }, data: { status: newStatus } });
  res.json({ ok: true, active: isInactive });  // returneaza noua stare (toggled)
});

// Self plan status (pentru WorkoutPage)
router.get('/self-plan-status', async (req, res) => {
  const workout = await prisma.workout.findFirst({
    where: { userId: req.user.id, status: { startsWith: 'PLAN:' } },
    select: { id: true, status: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!workout) return res.json({ exists: false, active: false });
  res.json({
    exists: true,
    id: workout.id,
    active: !String(workout.status || '').endsWith(':INACTIVE'),
  });
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

// PATCH /exercises/:id - editare seturi/repetari/kg/timp pauza
// Atletul poate modifica orice exercitiu din workout-urile sale (plan propriu SAU plan de la coach)
router.patch('/exercises/:id', async (req, res) => {
  const exercise = await prisma.workoutExercise.findFirst({
    where: {
      id: req.params.id,
      workout: {
        userId: req.user.id,
        OR: [
          { status: { startsWith: 'PLAN:' } },     // plan propriu
          { status: { startsWith: 'COACH:' } },    // plan asignat de coach
          { status: 'ACTIVE' },                     // sesiune activa in desfasurare
        ],
      },
    },
  });
  if (!exercise) return res.status(404).json({ error: 'Exercițiu negăsit' });

  const { sets, reps, weight, restSec, name } = req.body || {};
  const data = {};

  if (sets !== undefined) {
    const v = Math.max(1, Math.min(20, Number(sets) || 0));
    if (v > 0) data.sets = v;
  }
  if (reps !== undefined) {
    const v = Math.max(1, Math.min(100, Number(reps) || 0));
    if (v > 0) data.reps = v;
  }
  if (weight !== undefined) {
    const v = Math.max(0, Math.min(500, Number(weight) || 0));
    // Stocam exact valoarea (inclusiv 0) - normalizatorul ascunde la afisare daca = 0
    data.weight = v;
  }
  if (restSec !== undefined) {
    const v = Math.max(0, Math.min(600, Number(restSec) || 0));
    data.restSec = v;
  }
  if (name !== undefined && typeof name === 'string') {
    const v = name.trim();
    if (v.length >= 2 && v.length <= 100) data.name = v;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Nicio valoare validă pentru update' });
  }

  const updated = await prisma.workoutExercise.update({
    where: { id: exercise.id },
    data,
  });

  // Emit Socket.IO catre coach (daca atletul e atribuit la un coach) ca sa vada modificarile live
  const coachLink = await prisma.coachClient.findFirst({
    where: { athleteId: req.user.id, status: 'ACTIVE' },
    select: { coachId: true },
  });
  if (coachLink?.coachId) {
    global.__io?.to(`user:${coachLink.coachId}`).emit('athlete:exercise:updated', {
      athleteId: req.user.id,
      exercise: normalizeWorkoutExercise(updated),
    });
  }

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

  // Determină ce plan să pornească: propriu (default) sau coach
  const source = String(req.body?.source || req.query?.source || 'self').toLowerCase();
  let plan;
  if (source === 'coach') {
    plan = await prisma.workout.findFirst({
      where: {
        userId: req.user.id,
        status: { startsWith: 'COACH:' },
        NOT: { status: { endsWith: ':INACTIVE' } },  // doar planuri active
      },
      include: { exercises: { orderBy: { order: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!plan || !plan.exercises?.length) {
      return res.status(400).json({ error: 'Nu ai un plan activ de la coach.' });
    }
  } else {
    plan = await prisma.workout.findFirst({
      where: {
        userId: req.user.id,
        status: { startsWith: 'PLAN:' },
        NOT: { status: { endsWith: ':INACTIVE' } },  // doar planuri active
      },
      include: { exercises: { orderBy: { order: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!plan || !plan.exercises?.length) {
      return res.status(400).json({ error: 'Nu ai un plan activ.' });
    }
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
          restSec: exercise.restSec,  // copiaza pauza setata
          order: exercise.order,
          done: false,
          weight: exercise.weight || 0,  // FIX: copiaza kg-ul setat (era hardcoded la 0)
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

// NOU: Istoric antrenamente pe ultimele 7 zile, agregat per zi
router.get('/workout/history-7days', async (req, res) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const workouts = await prisma.workout.findMany({
    where: {
      userId: req.user.id,
      status: { in: ['COMPLETED', 'ABANDONED'] },
      createdAt: { gte: sevenDaysAgo },
    },
    include: { exercises: true },
    orderBy: { createdAt: 'asc' },
  });

  // Grupez per zi (YYYY-MM-DD)
  const dayMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    dayMap[key] = {
      date: key,
      iso: d.toISOString(),
      workouts: 0,
      totalSets: 0,
      completedSets: 0,
      totalExercises: 0,
      completedExercises: 0,
      durationSeconds: 0,
      details: [],
    };
  }

  for (const w of workouts) {
    const key = new Date(w.createdAt).toISOString().slice(0, 10);
    if (!dayMap[key]) continue;
    const exercises = w.exercises || [];
    const totalSets = exercises.reduce((s, e) => s + Number(e.sets || 0), 0);
    const compSets = exercises.reduce((s, e) => s + Math.min(Number(e.sets || 0), Number(e.setsCompleted || 0)), 0);
    const compEx = exercises.filter((e) => Number(e.setsCompleted || 0) >= Number(e.sets || 0) && Number(e.sets || 0) > 0).length;
    // Durata estimată: timpul între createdAt și updatedAt
    const dur = Math.max(0, Math.floor((new Date(w.updatedAt) - new Date(w.createdAt)) / 1000));
    dayMap[key].workouts += 1;
    dayMap[key].totalSets += totalSets;
    dayMap[key].completedSets += compSets;
    dayMap[key].totalExercises += exercises.length;
    dayMap[key].completedExercises += compEx;
    dayMap[key].durationSeconds += Math.min(dur, 60 * 60 * 4); // cap la 4h ca să nu cumuleze zile întregi dacă a uitat session-ul deschis
    dayMap[key].details.push({
      id: w.id,
      name: w.name,
      status: w.status,
      exercises: exercises.map((e) => ({
        name: e.name,
        setsCompleted: Number(e.setsCompleted || 0),
        setsTotal: Number(e.sets || 0),
      })),
    });
  }

  res.json(Object.values(dayMap));
});

// NOU: Exerciții făcute astăzi (din active session sau ultima completată azi)
router.get('/workout/today-progress', async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  // Caut workout-uri (ACTIVE, COMPLETED, ABANDONED) începute astăzi
  const todaysWorkouts = await prisma.workout.findMany({
    where: {
      userId: req.user.id,
      status: { in: ['ACTIVE', 'COMPLETED', 'ABANDONED'] },
      createdAt: { gte: start, lt: end },
    },
    include: { exercises: { orderBy: { order: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  });

  // Agreg exercițiile bifate din toate sesiunile de astăzi
  const exerciseProgress = [];
  for (const w of todaysWorkouts) {
    for (const ex of (w.exercises || [])) {
      const completed = Math.min(Number(ex.sets || 0), Number(ex.setsCompleted || 0));
      if (completed > 0 || ex.done) {
        exerciseProgress.push({
          name: ex.name,
          setsCompleted: completed,
          setsTotal: Number(ex.sets || 0),
          done: !!ex.done,
          workoutName: w.name,
          workoutStatus: w.status,
        });
      }
    }
  }

  res.json({
    count: exerciseProgress.length,
    exercises: exerciseProgress,
  });
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
