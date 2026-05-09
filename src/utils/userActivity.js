import { EXERCISE_LIBRARY, FOOD_DB } from './catalogs.js';
import { readLatestMeta } from './metaStore.js';

export function getDayWindow(base = new Date()) {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function formatClock(value) {
  if (!value) return '--:--';
  return new Date(value).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

export function athleteColor(name = '') {
  const colors = ['#1A52FF', '#7B2FBE', '#FF4422', '#15803D', '#B45309', '#0891B2', '#4ECDC4', '#A78BFA', '#F97316'];
  let hash = 0;
  for (const ch of String(name)) hash = ((hash * 31) + ch.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

export function trendFromCompliance(compliance = 0) {
  if (compliance >= 75) return 'up';
  if (compliance <= 35) return 'dn';
  return 'flat';
}

function normalizeFoodName(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findFoodByName(name = '') {
  const normalized = normalizeFoodName(name);
  if (!normalized) return null;
  return FOOD_DB.find((item) => {
    const candidate = normalizeFoodName(item.name);
    return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
  }) || null;
}

export function findExerciseByName(name = '') {
  const normalized = String(name).trim().toLowerCase();
  return EXERCISE_LIBRARY.find((item) => item.name.trim().toLowerCase() === normalized) || null;
}

export function normalizeWorkoutExercise(exercise) {
  const lib = findExerciseByName(exercise?.name || '');
  const repsLabel = Number.isFinite(exercise?.reps) ? String(exercise.reps) : String(exercise?.reps || '10');
  return {
    id: exercise.id,
    libId: lib?.id || null,
    name: exercise.name,
    muscle: lib?.muscle || 'General',
    equip: lib?.equip || 'Bodyweight',
    icon: lib?.icon || '💪',
    sets: `${exercise.sets}×${repsLabel}`,
    setsTotal: exercise.sets,
    reps: Number.isFinite(exercise?.reps) ? exercise.reps : repsLabel,
    detail: lib?.detail || (exercise.weight ? `${exercise.weight} kg` : 'Plan personalizat'),
    img: lib?.img || null,
    anim: lib?.anim || null,
    done: !!exercise.done,
    rest: exercise.restSec || 90,
    restSec: exercise.restSec || 90,
  };
}

export async function ensureUserGoals(prisma, userId) {
  let goals = await prisma.userGoals.findUnique({ where: { userId } });
  if (!goals) {
    goals = await prisma.userGoals.create({ data: { userId } });
  }
  const weightTargetMeta = await readLatestMeta(prisma, { userId, action: 'goal_weight_target' });
  return {
    ...goals,
    weightTarget: Number.isFinite(Number(weightTargetMeta?.weightTarget))
      ? Number(weightTargetMeta.weightTarget)
      : null,
  };
}

export async function getUserDailySummary(prisma, userId, { day = new Date() } = {}) {
  const { start, end } = getDayWindow(day);
  const [goals, mealRows, waterRows, latestSleep, stepsMeta, plannedWorkout, activeWorkout] = await Promise.all([
    ensureUserGoals(prisma, userId),
    prisma.nutritionLog.findMany({
      where: { userId, date: { gte: start, lt: end }, mealType: { not: 'WATER' } },
      orderBy: { date: 'asc' },
    }),
    prisma.nutritionLog.findMany({
      where: { userId, date: { gte: start, lt: end }, mealType: 'WATER' },
      orderBy: { date: 'asc' },
    }),
    prisma.sleepEntry.findFirst({ where: { userId }, orderBy: { date: 'desc' } }),
    readLatestMeta(prisma, { userId, action: 'today_steps', since: start }),
    prisma.workout.findFirst({
      where: { userId, status: { startsWith: 'PLAN' } },
      include: { exercises: { orderBy: { order: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.workout.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { exercises: { orderBy: { order: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const meals = mealRows.map((meal) => {
    const food = findFoodByName(meal.foodName);
    return {
      id: meal.id,
      meal: meal.mealType,
      mealType: meal.mealType,
      name: meal.foodName,
      kcal: meal.kcal,
      p: Number(meal.protein || 0),
      c: Number(meal.carbs || 0),
      f: Number(meal.fat || 0),
      fib: Number(food?.fib || 0),
      img: food?.img || null,
      time: formatClock(meal.date),
      date: meal.date,
    };
  });

  const macros = meals.reduce((acc, meal) => {
    acc.kcal += Number(meal.kcal || 0);
    acc.p += Number(meal.p || 0);
    acc.c += Number(meal.c || 0);
    acc.f += Number(meal.f || 0);
    acc.fib += Number(meal.fib || 0);
    return acc;
  }, { kcal: 0, p: 0, c: 0, f: 0, fib: 0 });

  const rawWaterCups = Math.round(waterRows.reduce((sum, row) => sum + Number(row.quantity || 1), 0));
  const waterTargetCupsCalc = Math.max(4, Math.round((Number(goals?.water || 3)) * 4));
  // Clamp at read time to prevent legacy/corrupted data from showing >100% values
  const waterCups = Math.min(rawWaterCups, waterTargetCupsCalc);
  const sleepHours = Number(latestSleep?.hours || 0);
  const sleepScore = Number(latestSleep?.score || 0);
  const steps = Math.max(0, Number(stepsMeta?.steps || 0));

  const planWorkout = plannedWorkout || activeWorkout;
  const exercises = (planWorkout?.exercises || []).map(normalizeWorkoutExercise);
  const exercisesDone = exercises.filter((item) => item.done).length;
  const exercisesTotal = exercises.length;
  const progressPct = exercisesTotal ? Math.round((exercisesDone / exercisesTotal) * 100) : 0;

  const activeSession = activeWorkout ? normalizeActiveSession(activeWorkout) : null;

  return {
    goals,
    meals,
    macros,
    waterCups,
    waterLiters: Number((waterCups / 4).toFixed(1)),
    waterTargetCups: waterTargetCupsCalc,
    sleepHours,
    sleepScore,
    steps,
    exercises,
    exercisesDone,
    exercisesTotal,
    progressPct,
    kcalToday: macros.kcal,
    kcalTarget: Number(goals?.kcal || 2200),
    activeSession,
  };
}

export function normalizeActiveSession(activeWorkout) {
  const exercises = (activeWorkout?.exercises || []).map((exercise) => {
    const lib = findExerciseByName(exercise.name);
    return {
      id: exercise.id,
      name: exercise.name,
      muscle: lib?.muscle || 'General',
      equip: lib?.equip || 'Bodyweight',
      icon: lib?.icon || '💪',
      detail: lib?.detail || 'Set activ',
      img: lib?.img || null,
      anim: lib?.anim || null,
      setsTotal: exercise.sets,
      reps: Number.isFinite(exercise.reps) ? exercise.reps : String(exercise.reps || '10'),
      restSec: exercise.restSec || 90,
    };
  });
  const progress = Object.fromEntries(
    (activeWorkout?.exercises || []).map((exercise) => [exercise.id, {
      setsCompleted: Math.max(0, Math.min(exercise.sets, Number(exercise.setsCompleted || 0))),
    }]),
  );
  const totalSets = (activeWorkout?.exercises || []).reduce((sum, exercise) => sum + exercise.sets, 0);
  const completedSets = Object.values(progress).reduce((sum, value) => sum + Number(value.setsCompleted || 0), 0);
  const completedExercises = (activeWorkout?.exercises || []).filter((exercise) => Number(exercise.setsCompleted || 0) >= exercise.sets).length;
  return {
    id: activeWorkout.id,
    startedAt: activeWorkout.createdAt,
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - new Date(activeWorkout.createdAt).getTime()) / 1000)),
    exercises,
    progress,
    totalSets,
    completedSets,
    completedExercises,
  };
}

export function computeCompliance(summary) {
  const kcalTarget = Math.max(1, Number(summary?.kcalTarget || summary?.goals?.kcal || 2200));
  const kcalToday = Number(summary?.kcalToday || summary?.macros?.kcal || 0);
  const nutritionRatio = kcalToday === 0 ? 0 : Math.min(100, Math.round((Math.min(kcalToday, kcalTarget) / kcalTarget) * 100));
  const exerciseRatio = Number(summary?.exercisesTotal)
    ? Math.round((Number(summary.exercisesDone || 0) / Number(summary.exercisesTotal || 1)) * 100)
    : (kcalToday > 0 ? 60 : 0);
  const waterRatio = summary?.waterTargetCups
    ? Math.min(100, Math.round((Number(summary.waterCups || 0) / Number(summary.waterTargetCups || 1)) * 100))
    : 0;
  const parts = [nutritionRatio, exerciseRatio, waterRatio].filter((value) => Number.isFinite(value));
  if (!parts.length) return 0;
  return Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length);
}

export async function getUserHistory(prisma, userId, days = 7) {
  const output = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    const summary = await getUserDailySummary(prisma, userId, { day });
    output.push(computeCompliance(summary));
  }
  return output;
}
