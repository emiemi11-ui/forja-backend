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

async function formatChallengeList(userId) {
  const challengeRows = await prisma.auditLog.findMany({
    where: { action: 'CHALLENGE_DEF', type: 'challenge' },
    include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return Promise.all(challengeRows.map(async (row) => {
    const payload = safeJsonParse(row.detail, {}) || {};
    const progressRows = await getProgressRows(row.id);
    const myProgressRow = progressRows.find((entry) => entry.userId === userId);
    const myProgress = Math.max(0, Number(myProgressRow?.payload?.progress || 0));
    const targetValue = Math.max(1, Number(payload.targetValue || 1));
    return {
      id: row.id,
      title: payload.title || 'Challenge',
      description: payload.description || '',
      category: normalizeCategory(payload.category),
      targetValue,
      targetUnit: String(payload.targetUnit || 'unități'),
      durationDays: Math.max(1, Number(payload.durationDays || 30)),
      participantsCount: progressRows.length,
      joined: Boolean(myProgressRow),
      myProgress,
      myCompleted: myProgress >= targetValue,
      creator: row.user ? { id: row.user.id, name: row.user.name, avatar: row.user.avatar, avatarUrl: row.user.avatarUrl } : null,
      createdAt: row.createdAt,
      endsAt: payload.endsAt || null,
    };
  }));
}

router.get('/', async (req, res) => {
  const payload = await formatChallengeList(req.user.id);
  res.json(payload);
});

router.post('/', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const category = normalizeCategory(req.body?.category);
  const targetValue = Math.max(1, Number(req.body?.targetValue || 1));
  const targetUnit = String(req.body?.targetUnit || 'unități').trim() || 'unități';
  const durationDays = Math.max(1, Number(req.body?.durationDays || 30));

  if (!title) return res.status(400).json({ error: 'Titlul challenge-ului este obligatoriu.' });

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
        endsAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString(),
      }),
    },
  });

  await writeMeta(prisma, {
    userId: req.user.id,
    action: `CHALLENGE_PROGRESS:${challenge.id}`,
    type: 'challenge',
    detail: { challengeId: challenge.id, progress: 0 },
    status: 'ACTIVE',
  });

  res.status(201).json({ ok: true, id: challenge.id });
});

router.post('/:id/join', async (req, res) => {
  const challenge = await getChallengeRow(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge inexistent.' });

  const existing = await prisma.auditLog.findFirst({
    where: { userId: req.user.id, action: `CHALLENGE_PROGRESS:${req.params.id}`, type: 'challenge' },
    orderBy: { createdAt: 'desc' },
  });

  if (!existing) {
    await writeMeta(prisma, {
      userId: req.user.id,
      action: `CHALLENGE_PROGRESS:${req.params.id}`,
      type: 'challenge',
      detail: { challengeId: req.params.id, progress: 0 },
      status: 'ACTIVE',
    });
  }

  res.json({ ok: true });
});

router.patch('/:id/progress', async (req, res) => {
  const challenge = await getChallengeRow(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge inexistent.' });

  const payload = safeJsonParse(challenge.detail, {}) || {};
  const targetValue = Math.max(1, Number(payload.targetValue || 1));
  const progress = Math.max(0, Number(req.body?.progress || 0));

  await writeMeta(prisma, {
    userId: req.user.id,
    action: `CHALLENGE_PROGRESS:${req.params.id}`,
    type: 'challenge',
    detail: { challengeId: req.params.id, progress },
    status: progress >= targetValue ? 'SUCCESS' : 'ACTIVE',
  });

  res.json({ ok: true, progress, completed: progress >= targetValue });
});

router.get('/:id/leaderboard', async (req, res) => {
  const challenge = await getChallengeRow(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge inexistent.' });

  const progressRows = await getProgressRows(req.params.id);
  const leaderboard = progressRows
    .map((row) => ({
      userId: row.userId,
      name: row.user?.name || 'Utilizator',
      avatar: row.user?.avatar || row.user?.name?.[0] || 'U',
      avatarUrl: row.user?.avatarUrl || null,
      progress: Math.max(0, Number(row.payload?.progress || 0)),
    }))
    .sort((a, b) => b.progress - a.progress)
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  res.json(leaderboard);
});

export default router;
