import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();

router.use(authenticate);

function colorFromRole(role = '') {
  if (role === 'COACH') return '#1A52FF';
  if (role === 'NUTRITIONIST') return '#15803D';
  return '#B8ED00';
}

router.get('/', async (req, res) => {
  const q = String(req.query?.q || '').trim();
  if (!q) {
    return res.json({ query: '', teams: [], professionals: [], users: [], results: [] });
  }

  const whereText = { contains: q, mode: 'insensitive' };

  const [teams, professionals, users] = await Promise.all([
    prisma.team.findMany({
      where: { OR: [{ name: whereText }, { description: whereText }, { category: whereText }] },
      include: { _count: { select: { members: true } } },
      take: 8,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.user.findMany({
      where: {
        role: { in: ['COACH', 'NUTRITIONIST'] },
        blocked: false,
        OR: [{ name: whereText }, { bio: whereText }, { specialization: whereText }, { certifications: whereText }],
      },
      select: { id: true, name: true, role: true, avatar: true, avatarUrl: true, bio: true, specialization: true },
      take: 8,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.findMany({
      where: { blocked: false, role: 'USER', OR: [{ name: whereText }, { email: whereText }, { goal: whereText }] },
      select: { id: true, name: true, role: true, avatar: true, avatarUrl: true, goal: true },
      take: 8,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const teamResults = teams.map((team) => ({
    id: team.id,
    type: 'team',
    name: team.name,
    category: team.category,
    description: team.description || '',
    members: team._count.members,
    avatarUrl: team.avatarUrl,
  }));

  const professionalResults = professionals.map((user) => ({
    id: user.id,
    type: 'professional',
    name: user.name,
    role: user.role,
    avatar: user.avatar || user.name?.[0] || 'P',
    avatarUrl: user.avatarUrl,
    subtitle: user.specialization || user.bio || '',
    color: colorFromRole(user.role),
  }));

  const userResults = users.map((user) => ({
    id: user.id,
    type: 'user',
    name: user.name,
    role: user.role,
    avatar: user.avatar || user.name?.[0] || 'U',
    avatarUrl: user.avatarUrl,
    subtitle: user.goal || '',
    color: colorFromRole(user.role),
  }));

  res.json({
    query: q,
    teams: teamResults,
    professionals: professionalResults,
    users: userResults,
    results: [...professionalResults, ...teamResults, ...userResults],
  });
});

export default router;
