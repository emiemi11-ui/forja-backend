import { readAllMeta } from './metaStore.js';

export const ACHIEVEMENT_CATALOG = [
  { id: 'b1', name: '7 Zile Streak', img: '/img/badge-streak-7.svg', desc: 'Antrenament 7 zile consecutive' },
  { id: 'b2', name: '30 Zile Streak', img: '/img/badge-streak-30.svg', desc: 'Antrenament 30 zile consecutive' },
  { id: 'b3', name: 'Primul Antrenament', img: '/img/badge-first-workout.svg', desc: 'Ai completat primul antrenament' },
  { id: 'b4', name: '100 Exercitii', img: '/img/badge-100-exercises.svg', desc: '100 exercitii completate total' },
  { id: 'b5', name: 'Lider Echipa', img: '/img/badge-team-leader.svg', desc: 'Fii #1 in clasamentul echipei' },
  { id: 'b6', name: 'Nutritie Master', img: '/img/badge-nutrition-master.svg', desc: '30 zile de logging complet' },
  { id: 'b7', name: 'Somn Pro', img: '/img/badge-sleep-pro.svg', desc: 'Scor somn >85 timp de 14 zile' },
  { id: 'b8', name: 'Maratonist', img: '/img/badge-marathon.svg', desc: '42.195 pasi intr-o singura zi' },
  { id: 'b9', name: 'Consistenta', img: '/img/badge-consistency.svg', desc: 'Antrenament regulat 3 luni' },
  { id: 'b10', name: 'Early Bird', img: '/img/badge-early-bird.svg', desc: '10 antrenamente inainte de 7:00' },
];

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export async function buildAchievementsPayload(prisma, userId) {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [
    user,
    completedWorkouts,
    completedWorkoutRows,
    doneExercises,
    nutritionLogs,
    sleepEntries,
    teamLeader,
    existingAchievements,
    stepLogs,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, xp: true, streak: true } }),
    prisma.workout.count({ where: { userId, status: { startsWith: 'COMPLETED' } } }),
    prisma.workout.findMany({
      where: { userId, status: { startsWith: 'COMPLETED' } },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.workoutExercise.count({ where: { done: true, workout: { userId } } }),
    prisma.nutritionLog.findMany({ where: { userId, mealType: { not: 'WATER' } }, select: { date: true } }),
    prisma.sleepEntry.findMany({ where: { userId, score: { gte: 85 } }, select: { date: true } }),
    prisma.teamMember.findFirst({ where: { userId, role: { in: ['OWNER', 'ADMIN'] } }, select: { id: true } }),
    prisma.userAchievement.findMany({ where: { userId }, orderBy: { earnedAt: 'asc' } }),
    readAllMeta(prisma, { userId, action: 'today_steps' }),
  ]);

  if (!user) {
    return {
      badges: ACHIEVEMENT_CATALOG.map((badge) => ({ ...badge, earned: false, date: null })),
      stats: { workouts: 0, streak: 0, earned: 0, xp: 0 },
    };
  }

  const nutritionDays = new Set(nutritionLogs.map((row) => dayKey(row.date))).size;
  const highSleepDays = new Set(sleepEntries.map((row) => dayKey(row.date))).size;
  const maxSteps = stepLogs.reduce((max, row) => Math.max(max, Number(row.payload?.steps || 0)), 0);
  const earlyBirdWorkouts = completedWorkoutRows.filter((row) => new Date(row.createdAt).getHours() < 7).length;
  const consistentDays = new Set(
    completedWorkoutRows
      .filter((row) => new Date(row.createdAt) >= ninetyDaysAgo)
      .map((row) => dayKey(row.createdAt)),
  ).size;

  const rules = {
    b1: user.streak >= 7,
    b2: user.streak >= 30,
    b3: completedWorkouts >= 1 || doneExercises >= 1,
    b4: doneExercises >= 100,
    b5: Boolean(teamLeader),
    b6: nutritionDays >= 30,
    b7: highSleepDays >= 14,
    b8: maxSteps >= 42195,
    b9: user.streak >= 90 || consistentDays >= 24,
    b10: earlyBirdWorkouts >= 10,
  };

  const existingMap = new Map(existingAchievements.map((row) => [row.badge, row]));
  for (const badge of ACHIEVEMENT_CATALOG) {
    if (rules[badge.id] && !existingMap.has(badge.id)) {
      const created = await prisma.userAchievement.create({
        data: { userId, badge: badge.id, title: badge.name },
      });
      existingMap.set(badge.id, created);
    }
  }

  const badges = ACHIEVEMENT_CATALOG.map((badge) => {
    const earned = existingMap.get(badge.id);
    return {
      ...badge,
      earned: Boolean(earned),
      date: earned ? new Date(earned.earnedAt).toISOString().slice(0, 10) : null,
    };
  });

  const earnedCount = badges.filter((badge) => badge.earned).length;

  return {
    badges,
    stats: {
      workouts: completedWorkouts,
      streak: user.streak || 0,
      earned: earnedCount,
      xp: user.xp || 0,
    },
    insight: {
      nutritionDays,
      highSleepDays,
      maxSteps,
      earlyBirdWorkouts,
      consistentDays,
      doneExercises,
    },
  };
}
