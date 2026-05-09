import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { safeJsonParse, writeMeta } from '../utils/metaStore.js';
import prisma from '../lib/prisma.js';

const router = Router();

router.use(authenticate);

function normalizeCategory(value = '') {
  const allowed = ['fitness', 'running', 'nutrition', 'hidratare', 'somn', 'general'];
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : 'general';
}

function uniqueLatestByUser(rows = []) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = row.userId || row.user?.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

// Sanitizeaza activitatile dintr-un payload arbitrar (pentru creare/leaderboard)
function sanitizeActivities(rawActivities) {
  if (!Array.isArray(rawActivities)) return [];
  return rawActivities
    .filter((act) => act && typeof act.name === 'string' && act.name.trim().length > 0)
    .map((act, index) => ({
      id: String(act.id || `act_${Date.now()}_${index}`),
      name: String(act.name).trim().slice(0, 120),
      points: Math.max(1, Math.min(1000, Number(act.points) || 10)),
    }))
    .slice(0, 30);
}

function totalXpForActivities(activities = []) {
  return activities.reduce((sum, act) => sum + Math.max(0, Number(act.points) || 0), 0);
}

function progressFromCompletedIds(completedIds = [], activities = []) {
  if (!activities.length) return 0;
  const set = new Set(completedIds || []);
  return activities.reduce((sum, act) => sum + (set.has(act.id) ? Math.max(0, Number(act.points) || 0) : 0), 0);
}

async function getChallengeRow(challengeId) {
  return prisma.auditLog.findFirst({
    where: { id: challengeId, action: 'CHALLENGE_DEF', type: 'challenge' },
    include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true } } },
  });
}

async function getProgressRows(challengeId) {
  const rows = await prisma.auditLog.findMany({
    where: { action: `CHALLENGE_PROGRESS:${challengeId}`, type: 'challenge' },
    include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return uniqueLatestByUser(rows).map((row) => ({ ...row, payload: safeJsonParse(row.detail, {}) }));
}

// Verifica daca userul curent are voie sa vada/participe la un challenge cu teamId.
async function userCanAccessTeamChallenge(userId, teamId) {
  if (!teamId) return true;
  const member = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  return Boolean(member);
}

async function formatChallengeList(userId, { teamId = null } = {}) {
  const challengeRows = await prisma.auditLog.findMany({
    where: { action: 'CHALLENGE_DEF', type: 'challenge' },
    include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const myTeams = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const myTeamIds = new Set(myTeams.map((m) => m.teamId));

  const formatted = await Promise.all(challengeRows.map(async (row) => {
    const payload = safeJsonParse(row.detail, {}) || {};
    const challengeTeamId = payload.teamId || null;

    // Filtrare dupa teamId solicitat in query
    if (teamId && challengeTeamId !== teamId) return null;

    // Challenge-urile de echipa NU apar la useri ne-membri
    if (challengeTeamId && !myTeamIds.has(challengeTeamId)) return null;

    const activities = sanitizeActivities(payload.activities);
    const progressRows = await getProgressRows(row.id);
    const myProgressRow = progressRows.find((entry) => entry.userId === userId);
    const myCompletedIds = Array.isArray(myProgressRow?.payload?.completedActivityIds)
      ? myProgressRow.payload.completedActivityIds
      : [];

    const useActivitiesMode = activities.length > 0;
    const targetValue = useActivitiesMode
      ? totalXpForActivities(activities)
      : Math.max(1, Number(payload.targetValue || 1));

    const myProgress = useActivitiesMode
      ? progressFromCompletedIds(myCompletedIds, activities)
      : Math.max(0, Number(myProgressRow?.payload?.progress || 0));

    return {
      id: row.id,
      title: payload.title || 'Challenge',
      description: payload.description || '',
      category: normalizeCategory(payload.category),
      teamId: challengeTeamId,
      activities,
      hasActivities: useActivitiesMode,
      totalXp: useActivitiesMode ? totalXpForActivities(activities) : null,
      targetValue,
      targetUnit: useActivitiesMode ? 'XP' : String(payload.targetUnit || 'unitati'),
      durationDays: Math.max(1, Number(payload.durationDays || 30)),
      participantsCount: progressRows.length,
      joined: Boolean(myProgressRow),
      myProgress,
      myCompletedActivityIds: myCompletedIds,
      myCompleted: myProgress >= targetValue,
      creator: row.user ? { id: row.user.id, name: row.user.name, avatar: row.user.avatar, avatarUrl: row.user.avatarUrl } : null,
      createdAt: row.createdAt,
      endsAt: payload.endsAt || null,
    };
  }));

  return formatted.filter(Boolean);
}

router.get('/', async (req, res) => {
  const teamId = req.query?.teamId ? String(req.query.teamId) : null;
  const payload = await formatChallengeList(req.user.id, { teamId });
  res.json(payload);
});

router.post('/', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const category = normalizeCategory(req.body?.category);
  const targetValue = Math.max(1, Number(req.body?.targetValue || 1));
  const targetUnit = String(req.body?.targetUnit || 'unitati').trim() || 'unitati';
  const durationDays = Math.max(1, Number(req.body?.durationDays || 30));
  const teamId = req.body?.teamId ? String(req.body.teamId) : null;
  const activities = sanitizeActivities(req.body?.activities);

  if (!title) return res.status(400).json({ error: 'Titlul challenge-ului este obligatoriu.' });

  // Daca e team-scoped, userul trebuie sa fie membru al echipei
  if (teamId) {
    const member = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId: req.user.id, teamId } },
    });
    if (!member) {
      return res.status(403).json({ error: 'Trebuie sa fii membru al echipei ca sa creezi un challenge acolo.' });
    }
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Doar OWNER sau ADMIN pot crea challenges in echipa.' });
    }
  }

  const challenge = await prisma.auditLog.create({
    data: {
      userId: req.user.id,
      action: 'CHALLENGE_DEF',
      type: 'challenge',
      status: 'ACTIVE',
      detail: JSON.stringify({
        title,
        description,
        category,
        targetValue,
        targetUnit,
        durationDays,
        teamId,
        activities,
        endsAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString(),
      }),
    },
  });

  await writeMeta(prisma, {
    userId: req.user.id,
    action: `CHALLENGE_PROGRESS:${challenge.id}`,
    type: 'challenge',
    detail: { challengeId: challenge.id, progress: 0, completedActivityIds: [] },
    status: 'ACTIVE',
  });

  res.status(201).json({ ok: true, id: challenge.id });
});

router.post('/:id/join', async (req, res) => {
  const challenge = await getChallengeRow(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge inexistent.' });

  const payload = safeJsonParse(challenge.detail, {}) || {};
  const allowed = await userCanAccessTeamChallenge(req.user.id, payload.teamId);
  if (!allowed) {
    return res.status(403).json({ error: 'Acest challenge e doar pentru membrii echipei.' });
  }

  const existing = await prisma.auditLog.findFirst({
    where: { userId: req.user.id, action: `CHALLENGE_PROGRESS:${req.params.id}`, type: 'challenge' },
    orderBy: { createdAt: 'desc' },
  });

  if (!existing) {
    await writeMeta(prisma, {
      userId: req.user.id,
      action: `CHALLENGE_PROGRESS:${req.params.id}`,
      type: 'challenge',
      detail: { challengeId: req.params.id, progress: 0, completedActivityIds: [] },
      status: 'ACTIVE',
    });
  }

  res.json({ ok: true });
});

router.patch('/:id/progress', async (req, res) => {
  const challenge = await getChallengeRow(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge inexistent.' });

  const payload = safeJsonParse(challenge.detail, {}) || {};
  const allowed = await userCanAccessTeamChallenge(req.user.id, payload.teamId);
  if (!allowed) {
    return res.status(403).json({ error: 'Nu ai acces la acest challenge.' });
  }

  const targetValue = Math.max(1, Number(payload.targetValue || 1));
  const progress = Math.max(0, Number(req.body?.progress || 0));

  await writeMeta(prisma, {
    userId: req.user.id,
    action: `CHALLENGE_PROGRESS:${req.params.id}`,
    type: 'challenge',
    detail: { challengeId: req.params.id, progress, completedActivityIds: [] },
    status: progress >= targetValue ? 'SUCCESS' : 'ACTIVE',
  });

  res.json({ ok: true, progress, completed: progress >= targetValue });
});

// POST /:id/activities/:activityId/toggle
// Bifeaza / debifeaza o activitate. Recalculeaza progresul (XP) si acorda XP la UserStats.
router.post('/:id/activities/:activityId/toggle', async (req, res) => {
  const challenge = await getChallengeRow(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge inexistent.' });

  const payload = safeJsonParse(challenge.detail, {}) || {};
  const allowed = await userCanAccessTeamChallenge(req.user.id, payload.teamId);
  if (!allowed) {
    return res.status(403).json({ error: 'Nu ai acces la acest challenge.' });
  }

  const activities = sanitizeActivities(payload.activities);
  if (activities.length === 0) {
    return res.status(400).json({ error: 'Acest challenge nu are activitati configurate.' });
  }

  const activity = activities.find((act) => act.id === req.params.activityId);
  if (!activity) return res.status(404).json({ error: 'Activitate inexistenta.' });

  const previousProgressRow = await prisma.auditLog.findFirst({
    where: { userId: req.user.id, action: `CHALLENGE_PROGRESS:${req.params.id}`, type: 'challenge' },
    orderBy: { createdAt: 'desc' },
  });
  const previousPayload = safeJsonParse(previousProgressRow?.detail, {}) || {};
  const previousIds = new Set(Array.isArray(previousPayload.completedActivityIds) ? previousPayload.completedActivityIds : []);

  let xpDelta = 0;
  let nowChecked;
  if (previousIds.has(activity.id)) {
    previousIds.delete(activity.id);
    xpDelta = -activity.points;
    nowChecked = false;
  } else {
    previousIds.add(activity.id);
    xpDelta = activity.points;
    nowChecked = true;
  }

  const newCompletedIds = [...previousIds];
  const newProgress = progressFromCompletedIds(newCompletedIds, activities);
  const totalXp = totalXpForActivities(activities);

  await writeMeta(prisma, {
    userId: req.user.id,
    action: `CHALLENGE_PROGRESS:${req.params.id}`,
    type: 'challenge',
    detail: { challengeId: req.params.id, progress: newProgress, completedActivityIds: newCompletedIds },
    status: newProgress >= totalXp ? 'SUCCESS' : 'ACTIVE',
  });

  // Acorda XP DELTA in UserStats (pozitiv la bifare, negativ la debifare)
  if (xpDelta !== 0) {
    try {
      await prisma.userStats.upsert({
        where: { userId: req.user.id },
        create: {
          userId: req.user.id,
          totalXp: Math.max(0, xpDelta),
          dailyXp: Math.max(0, xpDelta),
        },
        update: {
          totalXp: { increment: xpDelta },
          dailyXp: { increment: xpDelta },
        },
      });
    } catch {
      // Daca UserStats are constraint issue, nu blocam toggle-ul
    }
  }

  res.json({
    ok: true,
    isChecked: nowChecked,
    progress: newProgress,
    totalXp,
    xpDelta,
  });
});

router.get('/:id/leaderboard', async (req, res) => {
  const challenge = await getChallengeRow(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge inexistent.' });

  const payload = safeJsonParse(challenge.detail, {}) || {};
  const activities = sanitizeActivities(payload.activities);
  const useActivitiesMode = activities.length > 0;
  const totalXp = useActivitiesMode ? totalXpForActivities(activities) : Math.max(1, Number(payload.targetValue || 1));

  const progressRows = await getProgressRows(req.params.id);

  // Pentru challenges de echipa, limitam leaderboard-ul la membrii echipei
  let allowedUserIds = null;
  if (payload.teamId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: payload.teamId },
      select: { userId: true },
    });
    allowedUserIds = new Set(members.map((m) => m.userId));
  }

  const filteredRows = allowedUserIds
    ? progressRows.filter((row) => allowedUserIds.has(row.userId))
    : progressRows;

  const leaderboard = filteredRows
    .map((row) => {
      const completedIds = Array.isArray(row.payload?.completedActivityIds) ? row.payload.completedActivityIds : [];
      const score = useActivitiesMode
        ? progressFromCompletedIds(completedIds, activities)
        : Math.max(0, Number(row.payload?.progress || 0));
      return {
        userId: row.userId,
        name: row.user?.name || 'Utilizator',
        avatar: row.user?.avatar || row.user?.name?.[0] || 'U',
        avatarUrl: row.user?.avatarUrl || null,
        progress: score,
        completedActivities: useActivitiesMode ? completedIds.length : null,
      };
    })
    .sort((a, b) => b.progress - a.progress)
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  res.json({
    leaderboard,
    totalXp,
    isActivitiesMode: useActivitiesMode,
    activitiesCount: activities.length,
    teamId: payload.teamId || null,
  });
});

// DELETE /:id — doar creator-ul sau OWNER-ul echipei poate sterge
router.delete('/:id', async (req, res) => {
  const challenge = await getChallengeRow(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge inexistent.' });

  const payload = safeJsonParse(challenge.detail, {}) || {};
  const isCreator = challenge.userId === req.user.id;
  let isTeamManager = false;
  if (payload.teamId) {
    const member = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId: req.user.id, teamId: payload.teamId } },
    });
    isTeamManager = member?.role === 'OWNER' || member?.role === 'ADMIN';
  }

  if (!isCreator && !isTeamManager && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Nu ai voie sa stergi acest challenge.' });
  }

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { id: req.params.id },
        { action: `CHALLENGE_PROGRESS:${req.params.id}` },
      ],
    },
  });

  res.json({ ok: true });
});

export default router;
