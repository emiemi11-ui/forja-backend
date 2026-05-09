import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { EXERCISE_LIBRARY, parseSets } from '../utils/catalogs.js';
import { readLatestMeta } from '../utils/metaStore.js';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(authenticate, requireRole('COACH', 'ADMIN'));

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function colorFromString(input = '') {
  const palette = ['#1A52FF', '#7B2FBE', '#15803D', '#FF4422', '#B45309', '#2563EB'];
  const sum = [...String(input)].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return palette[sum % palette.length];
}

function matchLibrary(name) {
  return EXERCISE_LIBRARY.find((item) => item.name === name) || null;
}

function parseTemplateCategory(status = '') {
  return String(status).startsWith('TEMPLATE:') ? String(status).slice('TEMPLATE:'.length) : 'General';
}

async function getHydration(userId) {
  const since = startOfDay();
  const [waterRows, steps] = await Promise.all([
    prisma.nutritionLog.findMany({ where: { userId, date: { gte: since }, mealType: 'WATER' } }),
    readLatestMeta(prisma, { userId, action: 'today_steps', since }),
  ]);
  return {
    waterCups: Math.round(waterRows.reduce((sum, row) => sum + Number(row.quantity || 1), 0)),
    steps: Number(steps?.steps || 0),
  };
}

async function buildAthleteCard(link) {
  const athlete = link.athlete;
  const since = startOfDay();
  const [goals, planWorkout, meals, hydration] = await Promise.all([
    prisma.userGoals.findUnique({ where: { userId: athlete.id } }),
    prisma.workout.findFirst({ where: { userId: athlete.id, status: { startsWith: 'PLAN' } }, include: { exercises: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.nutritionLog.findMany({ where: { userId: athlete.id, date: { gte: since } } }),
    getHydration(athlete.id),
  ]);
  const kcalToday = meals.reduce((sum, meal) => sum + meal.kcal, 0);
  const done = planWorkout?.exercises?.filter((exercise) => exercise.done).length || 0;
  const total = planWorkout?.exercises?.length || 0;
  const compliance = total ? Math.round((done / total) * 100) : 0;
  return {
    id: athlete.id,
    name: athlete.name,
    av: athlete.avatar || athlete.name?.[0] || 'A',
    col: colorFromString(athlete.id),
    avatarUrl: athlete.avatarUrl,
    notes: link.notes || athlete.goal || '',
    weight: athlete.weight || 0,
    trend: compliance >= 75 ? 'up' : compliance >= 40 ? 'flat' : 'dn',
    plan: athlete.plan,
    goal: athlete.goal || '',
    inviteStatus: link.status,
    status: link.status,
    last: new Date(link.createdAt).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' }),
    compliance,
    kcal_today: kcalToday,
    kcal_target: goals?.kcal || 2200,
    waterCups: hydration.waterCups,
    steps: hydration.steps,
    linked: link.status === 'ACCEPTED',
    journal: link.notes ? [{ text: link.notes, date: new Date(link.createdAt).toISOString().slice(0, 10) }] : [],
  };
}

async function getCoachTeamData(userId, name) {
  const ownerMembership = await prisma.teamMember.findFirst({
    where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
    include: { team: { include: { _count: { select: { members: true } } } } },
    orderBy: { joinedAt: 'desc' },
  });
  if (!ownerMembership?.team) {
    return { name: '', coachName: name, members: 0, active_today: 0, compliance_week: 0, workouts: 0 };
  }
  const team = ownerMembership.team;
  const acceptedClients = await prisma.coachClient.findMany({
    where: { coachId: userId, status: 'ACCEPTED' },
    include: { athlete: { select: { id: true } } },
  });
  const plans = await prisma.workout.count({ where: { userId, status: { startsWith: 'TEMPLATE:' } } });
  return {
    id: team.id,
    name: team.name,
    coachName: name,
    members: team._count.members,
    active_today: acceptedClients.length,
    compliance_week: acceptedClients.length ? 75 : 0,
    workouts: plans,
    category: team.category,
    revenue: acceptedClients.length * 149,
  };
}

router.get('/overview', async (req, res) => {
  const [athleteLinks, team] = await Promise.all([
    prisma.coachClient.findMany({ where: { coachId: req.user.id }, include: { athlete: true }, orderBy: { createdAt: 'desc' } }),
    getCoachTeamData(req.user.id, req.user.name),
  ]);
  const athletes = await Promise.all(athleteLinks.map(buildAthleteCard));
  const workoutCount = await prisma.workout.count({ where: { userId: req.user.id, status: { startsWith: 'TEMPLATE:' } } });
  res.json({
    hero: { name: req.user.name, greeting: 'Bun venit!' },
    kpis: { athletes: athletes.filter((athlete) => athlete.inviteStatus === 'ACCEPTED').length, compliance: athletes.length ? Math.round(athletes.reduce((sum, athlete) => sum + athlete.compliance, 0) / athletes.length) : 0, workouts: workoutCount, activePlans: athletes.filter((athlete) => athlete.kcal_today > 0).length },
    athletesList: athletes,
    recentActivity: [],
    team,
  });
});

router.get('/team', async (req, res) => {
  const payload = await getCoachTeamData(req.user.id, req.user.name);
  res.json(payload);
});

router.get('/athletes', async (req, res) => {
  // Doar atleții ACCEPTED apar în lista activă. Cei PENDING_ATHLETE (coach a invitat,
  // așteaptă răspuns) sau PENDING (atletul a cerut, așteaptă răspuns coach) sunt
  // separați la /pending-invitations și /requests.
  const clients = await prisma.coachClient.findMany({
    where: { coachId: req.user.id, status: 'ACCEPTED' },
    include: { athlete: true },
    orderBy: { createdAt: 'desc' },
  });
  const payload = await Promise.all(clients.map(buildAthleteCard));
  res.json(payload);
});

// GET /api/coach/pending-invitations
// Invitații trimise de coach la atleți care încă nu au răspuns
router.get('/pending-invitations', async (req, res) => {
  const links = await prisma.coachClient.findMany({
    where: { coachId: req.user.id, status: 'PENDING_ATHLETE' },
    include: {
      athlete: { select: { id: true, name: true, email: true, avatar: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(links.map((link) => ({
    linkId: link.id,
    athlete: link.athlete,
    notes: link.notes,
    sentAt: link.createdAt,
  })));
});

router.get('/athletes/:id', async (req, res) => {
  const link = await prisma.coachClient.findUnique({
    where: { coachId_athleteId: { coachId: req.user.id, athleteId: req.params.id } },
    include: { athlete: true },
  });
  if (!link) return res.status(404).json({ error: 'Atlet inexistent' });

  const athlete = await buildAthleteCard(link);
  const since = startOfDay();
  const [goals, planWorkout, meals, recentCompleted, hydration] = await Promise.all([
    prisma.userGoals.findUnique({ where: { userId: link.athlete.id } }),
    prisma.workout.findFirst({ where: { userId: link.athlete.id, status: { startsWith: 'PLAN' } }, include: { exercises: { orderBy: { order: 'asc' } } } }),
    prisma.nutritionLog.findMany({ where: { userId: link.athlete.id, date: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.workout.findMany({ where: { userId: link.athlete.id, status: { startsWith: 'COMPLETED' } }, orderBy: { createdAt: 'desc' }, take: 7, include: { exercises: true } }),
    getHydration(link.athlete.id),
  ]);
  const macros = meals.reduce((acc, meal) => ({
    kcal: acc.kcal + meal.kcal,
    p: acc.p + Number(meal.protein || 0),
    c: acc.c + Number(meal.carbs || 0),
    f: acc.f + Number(meal.fat || 0),
  }), { kcal: 0, p: 0, c: 0, f: 0 });

  res.json({
    ...athlete,
    history: recentCompleted.map((workout) => ({
      date: workout.createdAt.toISOString().slice(5, 10),
      value: workout.exercises.filter((exercise) => exercise.done).length,
    })).reverse(),
    meals: meals.map((meal) => ({
      id: meal.id,
      type: meal.mealType,
      items: meal.foodName,
      kcal: meal.kcal,
    })),
    realData: {
      kcalToday: macros.kcal,
      kcalTarget: goals?.kcal || 2200,
      macros,
      waterCups: hydration.waterCups,
      steps: hydration.steps,
      weight: link.athlete.weight || 0,
      exercises: planWorkout?.exercises?.map((exercise) => {
        const lib = matchLibrary(exercise.name);
        return {
          id: exercise.id,
          name: exercise.name,
          sets: exercise.sets,
          reps: exercise.reps,
          done: exercise.done,
          muscle: lib?.muscle || 'General',
        };
      }) || [],
    },
  });
});

router.post('/athletes/invite', async (req, res) => {
  const { email, goal, plan } = req.body;
  const athlete = await prisma.user.findUnique({ where: { email } });
  if (!athlete) return res.status(404).json({ error: 'Utilizator inexistent' });
  if (athlete.id === req.user.id) return res.status(400).json({ error: 'Nu te poti adauga pe tine' });

  const link = await prisma.coachClient.upsert({
    where: { coachId_athleteId: { coachId: req.user.id, athleteId: athlete.id } },
    // Cand coach-ul invita, statusul e PENDING_ATHLETE (asteapta accept de la atlet)
    create: { coachId: req.user.id, athleteId: athlete.id, status: 'PENDING_ATHLETE', notes: goal || plan || null },
    update: { status: 'PENDING_ATHLETE', notes: goal || plan || undefined },
  });
  // Notifica atletul
  global.__io?.to(`user:${athlete.id}`).emit('professional:invite', {
    type: 'COACH',
    linkId: link.id,
    from: { id: req.user.id, name: req.user.name },
  });
  res.json({ ok: true, linkId: link.id });
});

// GET /api/coach/requests
// Cereri venite de la atleti (statusul e PENDING - atletul cere coach-ului)
router.get('/requests', async (req, res) => {
  const requests = await prisma.coachClient.findMany({
    where: { coachId: req.user.id, status: 'PENDING' },
    include: {
      athlete: { select: { id: true, name: true, email: true, avatar: true, avatarUrl: true, goal: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(requests.map((r) => ({
    linkId: r.id,
    athlete: r.athlete,
    notes: r.notes,
    requestedAt: r.createdAt,
  })));
});

// POST /api/coach/requests/:linkId/accept
router.post('/requests/:linkId/accept', async (req, res) => {
  const link = await prisma.coachClient.findUnique({ where: { id: req.params.linkId } });
  if (!link || link.coachId !== req.user.id) {
    return res.status(404).json({ error: 'Cerere inexistenta' });
  }
  const updated = await prisma.coachClient.update({
    where: { id: link.id },
    data: { status: 'ACCEPTED' },
  });
  global.__io?.to(`user:${link.athleteId}`).emit('professional:request:accepted', {
    type: 'COACH',
    linkId: link.id,
    coach: { id: req.user.id, name: req.user.name },
  });
  res.json({ ok: true, status: updated.status });
});

// POST /api/coach/requests/:linkId/reject
router.post('/requests/:linkId/reject', async (req, res) => {
  const link = await prisma.coachClient.findUnique({ where: { id: req.params.linkId } });
  if (!link || link.coachId !== req.user.id) {
    return res.status(404).json({ error: 'Cerere inexistenta' });
  }
  await prisma.coachClient.delete({ where: { id: link.id } });
  global.__io?.to(`user:${link.athleteId}`).emit('professional:request:rejected', {
    type: 'COACH',
    linkId: link.id,
  });
  res.json({ ok: true });
});

router.get('/workouts', async (req, res) => {
  const workouts = await prisma.workout.findMany({
    where: { userId: req.user.id, status: { startsWith: 'TEMPLATE:' } },
    include: { exercises: true },
    orderBy: { updatedAt: 'desc' },
  });
  const payload = await Promise.all(workouts.map(async (workout) => ({
    id: workout.id,
    name: workout.name,
    category: parseTemplateCategory(workout.status),
    exercises: workout.exercises.length,
    assigned: await prisma.workout.count({ where: { status: `PLAN:${workout.id}` } }),
  })));
  res.json(payload);
});

router.get('/workouts/:id', async (req, res) => {
  const workout = await prisma.workout.findFirst({
    where: { id: req.params.id, userId: req.user.id, status: { startsWith: 'TEMPLATE:' } },
    include: { exercises: { orderBy: { order: 'asc' } } },
  });
  if (!workout) return res.status(404).json({ error: 'Plan inexistent' });
  res.json({
    id: workout.id,
    name: workout.name,
    category: parseTemplateCategory(workout.status),
    exercises: workout.exercises.map((exercise) => {
      const lib = matchLibrary(exercise.name);
      return {
        id: exercise.id,
        libId: lib?.id || exercise.name,
        name: exercise.name,
        muscle: lib?.muscle || 'General',
        equip: lib?.equip || 'Nespecificat',
        sets: exercise.sets,
        reps: exercise.reps,
        rest: exercise.restSec,
        img: lib?.img || null,
        anim: lib?.anim || null,
        icon: lib?.icon || '🏋️',
      };
    }),
  });
});

router.post('/workouts', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || 'General').trim();
  const exercises = Array.isArray(req.body.exercises) ? req.body.exercises : [];
  if (!name) return res.status(400).json({ error: 'Numele planului este obligatoriu' });
  if (!exercises.length) return res.status(400).json({ error: 'Adaugă cel puțin un exercițiu' });

  const workout = await prisma.workout.create({
    data: {
      userId: req.user.id,
      name,
      status: `TEMPLATE:${category}`,
      exercises: {
        create: exercises.map((exercise, index) => {
          const lib = matchLibrary(exercise.name) || EXERCISE_LIBRARY.find((item) => String(item.id) === String(exercise.libId));
          const parsed = lib ? parseSets(lib.sets) : { sets: Number(exercise.sets || 4), reps: Number(exercise.reps || 8) };
          return {
            name: lib?.name || exercise.name,
            sets: Number(exercise.sets || parsed.sets || 4),
            reps: Number(exercise.reps || parsed.reps || 8),
            restSec: Number(exercise.rest || 90),
            order: index,
          };
        }),
      },
    },
    include: { exercises: true },
  });
  res.status(201).json({ ok: true, id: workout.id });
});

// PUT /workouts/:id — Editeaza un plan de antrenament al coach-ului
router.put('/workouts/:id', async (req, res) => {
  const workout = await prisma.workout.findFirst({
    where: { id: req.params.id, userId: req.user.id, status: { startsWith: 'TEMPLATE:' } },
  });
  if (!workout) return res.status(404).json({ error: 'Plan inexistent' });

  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || 'General').trim();
  const exercises = Array.isArray(req.body.exercises) ? req.body.exercises : [];
  if (!name) return res.status(400).json({ error: 'Numele planului este obligatoriu' });
  if (!exercises.length) return res.status(400).json({ error: 'Adaugă cel puțin un exercițiu' });

  // Sterge toate exercitiile vechi si recreaza
  await prisma.workoutExercise.deleteMany({ where: { workoutId: workout.id } });
  await prisma.workout.update({
    where: { id: workout.id },
    data: {
      name,
      status: `TEMPLATE:${category}`,
      exercises: {
        create: exercises.map((exercise, index) => {
          const lib = matchLibrary(exercise.name) || EXERCISE_LIBRARY.find((item) => String(item.id) === String(exercise.libId));
          const parsed = lib ? parseSets(lib.sets) : { sets: Number(exercise.sets || 4), reps: Number(exercise.reps || 8) };
          return {
            name: lib?.name || exercise.name,
            sets: Number(exercise.sets || parsed.sets || 4),
            reps: Number(exercise.reps || parsed.reps || 8),
            restSec: Number(exercise.rest || 90),
            order: index,
          };
        }),
      },
    },
  });
  res.json({ ok: true });
});

// DELETE /workouts/:id — Sterge un plan de antrenament al coach-ului
router.delete('/workouts/:id', async (req, res) => {
  const workout = await prisma.workout.findFirst({
    where: { id: req.params.id, userId: req.user.id, status: { startsWith: 'TEMPLATE:' } },
  });
  if (!workout) return res.status(404).json({ error: 'Plan inexistent' });
  await prisma.workoutExercise.deleteMany({ where: { workoutId: workout.id } });
  await prisma.workout.delete({ where: { id: workout.id } });
  res.json({ ok: true });
});

router.post('/workouts/:id/assign', async (req, res) => {
  const template = await prisma.workout.findFirst({
    where: { id: req.params.id, userId: req.user.id, status: { startsWith: 'TEMPLATE:' } },
    include: { exercises: { orderBy: { order: 'asc' } } },
  });
  if (!template) return res.status(404).json({ error: 'Plan inexistent' });
  const athleteIds = Array.isArray(req.body.athleteIds) ? req.body.athleteIds : [];
  if (!athleteIds.length) return res.status(400).json({ error: 'Selectează atleți' });

  await Promise.all(athleteIds.map(async (athleteId) => {
    const link = await prisma.coachClient.upsert({
      where: { coachId_athleteId: { coachId: req.user.id, athleteId } },
      create: { coachId: req.user.id, athleteId, status: 'ACCEPTED' },
      update: { status: 'ACCEPTED' },
    });
    let planWorkout = await prisma.workout.findFirst({ where: { userId: athleteId, status: { startsWith: 'PLAN' } } });
    if (!planWorkout) {
      planWorkout = await prisma.workout.create({ data: { userId: athleteId, name: template.name, status: `PLAN:${template.id}` } });
    } else {
      await prisma.workout.update({ where: { id: planWorkout.id }, data: { name: template.name, status: `PLAN:${template.id}` } });
      await prisma.workoutExercise.deleteMany({ where: { workoutId: planWorkout.id } });
    }
    await prisma.workoutExercise.createMany({
      data: template.exercises.map((exercise, index) => ({
        workoutId: planWorkout.id,
        name: exercise.name,
        sets: exercise.sets,
        reps: exercise.reps,
        restSec: exercise.restSec,
        done: false,
        order: index,
      })),
    });
    // Notifica atletul ca a primit un plan nou
    global.__io?.to(`user:${athleteId}`).emit('coach:plan:assigned', {
      coachId: req.user.id,
      coachName: req.user.name,
      planName: template.name,
    });
    return link;
  }));

  res.json({ ok: true });
});

router.get('/messages', async (req, res) => {
  const athleteLinks = await prisma.coachClient.findMany({ where: { coachId: req.user.id }, select: { athleteId: true } });
  const athleteIds = athleteLinks.map((link) => link.athleteId);
  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { user1Id: req.user.id, user2Id: { in: athleteIds } },
        { user2Id: req.user.id, user1Id: { in: athleteIds } },
      ],
    },
    include: {
      user1: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
      user2: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const payload = await Promise.all(conversations.map(async (conversation) => {
    const other = conversation.user1Id === req.user.id ? conversation.user2 : conversation.user1;
    const unread = await prisma.message.count({ where: { conversationId: conversation.id, senderId: { not: req.user.id }, read: false } });
    return {
      id: conversation.id,
      from: other.name,
      av: other.avatar || other.name?.[0] || 'A',
      col: colorFromString(other.id),
      avatarUrl: other.avatarUrl,
      time: conversation.messages[0]?.createdAt ? new Date(conversation.messages[0].createdAt).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
      msg: conversation.messages[0]?.content || 'Niciun mesaj',
      unread,
    };
  }));
  res.json(payload);
});

router.post('/messages/:id/reply', async (req, res) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
  if (!conversation) return res.status(404).json({ error: 'Conversație inexistentă' });
  const text = String(req.body.msg || '').trim();
  if (!text) return res.status(400).json({ error: 'Mesaj gol' });
  const message = await prisma.message.create({ data: { content: text, senderId: req.user.id, conversationId: conversation.id } });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  const recipientId = conversation.user1Id === req.user.id ? conversation.user2Id : conversation.user1Id;
  global.__io?.to(`user:${recipientId}`).emit('dm:new', {
    conversationId: conversation.id,
    message: {
      id: message.id,
      message: message.content,
      isMe: false,
      time: new Date(message.createdAt).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
    },
  });
  res.json({ ok: true });
});

router.patch('/messages/:id/read', async (req, res) => {
  await prisma.message.updateMany({ where: { conversationId: req.params.id, senderId: { not: req.user.id }, read: false }, data: { read: true } });
  res.json({ ok: true });
});

export default router;
