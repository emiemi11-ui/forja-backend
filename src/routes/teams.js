import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();

router.use(authenticate);

async function getTeamRole(teamId, userId) {
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { role: true },
  });
  return membership?.role || null;
}

async function ensureTeamManager(req, res, teamId = req.params.id) {
  if (req.user?.role === 'ADMIN') return true;
  const role = await getTeamRole(teamId, req.user.id);
  if (!['OWNER', 'ADMIN'].includes(role || '')) {
    res.status(403).json({ error: 'Doar ownerul sau adminii echipei pot face această acțiune.' });
    return false;
  }
  return true;
}

async function getActiveTeamSummary(userId) {
  const membership = await prisma.teamMember.findFirst({
    where: { userId },
    include: { team: true },
    orderBy: { joinedAt: 'asc' },
  });

  return {
    activeTeam: membership?.team?.name || '',
    activeTeamId: membership?.team?.id || null,
  };
}

function toListItem(team, userId) {
  const myMembership = team.members.find((member) => member.userId === userId);
  const owner = team.members.find((member) => member.role === 'OWNER');
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    description: team.description,
    category: team.category,
    teamType: String(team.teamType || '').toLowerCase(),
    isPublic: team.isPublic,
    avatarUrl: team.avatarUrl,
    membersCount: team._count.members,
    postsCount: team._count.posts,
    pendingRequestsCount: team._count.joinRequests,
    isMember: Boolean(myMembership),
    myRole: myMembership?.role || null,
    coach: owner?.user?.name || '',
    createdAt: team.createdAt,
  };
}

// GET /teams
router.get('/', async (req, res) => {
  const filter = String(req.query?.filter || 'all').trim().toLowerCase();
  const q = String(req.query?.q || '').trim();

  const where = {};
  if (filter === 'mine') {
    where.members = { some: { userId: req.user.id } };
  } else if (filter === 'public') {
    where.isPublic = true;
  } else if (req.user.role !== 'ADMIN') {
    where.OR = [
      { isPublic: true },
      { members: { some: { userId: req.user.id } } },
    ];
  }

  if (q) {
    const searchWhere = [
      { name: { contains: q, mode: 'insensitive' } },
      { category: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchWhere }];
      delete where.OR;
    } else {
      where.OR = searchWhere;
    }
  }

  const teams = await prisma.team.findMany({
    where,
    include: {
      _count: { select: { members: true, posts: true, joinRequests: true } },
      members: {
        where: { OR: [{ userId: req.user.id }, { role: 'OWNER' }] },
        include: { user: { select: { name: true, isDemo: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const visibleTeams = teams.filter((team) => {
    if (req.user.role === 'ADMIN' || req.user.isDemo) return true;
    const owner = team.members.find((member) => member.role === 'OWNER');
    const isOwnerDemo = Boolean(owner?.user?.isDemo);
    const isMyTeam = team.members.some((member) => member.userId === req.user.id);
    return !isOwnerDemo || isMyTeam;
  });

  res.json(visibleTeams.map((team) => toListItem(team, req.user.id)));
});

// POST /teams — create
router.post('/', async (req, res) => {
  const { name, description, category, isPublic } = req.body || {};
  const cleanName = String(name || '').trim();
  if (!cleanName) return res.status(400).json({ error: 'Numele echipei este obligatoriu.' });

  const slug = cleanName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `team-${Date.now()}`;

  const publicFlag = isPublic !== false;

  const team = await prisma.team.create({
    data: {
      name: cleanName,
      slug,
      description: description ? String(description) : null,
      category: category ? String(category) : 'Fitness',
      isPublic: publicFlag,
      teamType: publicFlag ? 'FREE' : 'PRIVATE',
    },
  });

  await prisma.teamMember.create({
    data: { userId: req.user.id, teamId: team.id, role: 'OWNER' },
  });

  res.status(201).json({
    ...team,
    isMember: true,
    myRole: 'OWNER',
    membersCount: 1,
    postsCount: 0,
    pendingRequestsCount: 0,
    activeTeam: team.name,
    activeTeamId: team.id,
    refreshSocket: true,
  });
});

// GET /teams/:id — detail
router.get('/:id', async (req, res) => {
  const team = await prisma.team.findUnique({
    where: { id: req.params.id },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, avatar: true, avatarUrl: true, role: true, isDemo: true } },
        },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      },
      posts: {
        include: {
          author: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
          comments: {
            include: { author: { select: { id: true, name: true, avatar: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      _count: { select: { members: true, posts: true } },
      joinRequests: {
        where: { status: 'PENDING' },
        include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!team) return res.status(404).json({ error: 'Echipă inexistentă' });

  const myMember = team.members.find((member) => member.userId === req.user.id);
  const owner = team.members.find((member) => member.role === 'OWNER');

  if (!req.user.isDemo && req.user.role !== 'ADMIN' && owner?.user?.isDemo && !myMember) {
    return res.status(404).json({ error: 'Echipă inexistentă' });
  }

  res.json({
    ...team,
    coach: owner?.user?.name || '',
    membersCount: team._count.members,
    postsCount: team._count.posts,
    isMember: Boolean(myMember),
    myRole: myMember?.role || null,
    members: team.members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      avatar: member.user.avatar || member.user.name?.charAt(0)?.toUpperCase() || 'U',
      avatarUrl: member.user.avatarUrl,
      teamRole: member.role,
      role: member.role,
      joinedAt: member.joinedAt,
      userRole: member.user.role,
    })),
    posts: !team.isPublic && !myMember && req.user.role !== 'ADMIN'
      ? []
      : team.posts.map((post) => ({
          id: post.id,
          author: post.author.name,
          authorId: post.author.id,
          authorAvatar: post.author.avatar || post.author.name?.charAt(0)?.toUpperCase() || 'U',
          authorAvatarUrl: post.author.avatarUrl,
          content: post.content,
          img: post.imageUrl,
          likes: post.likes,
          createdAt: post.createdAt,
          comments: post.comments.map((comment) => ({
            id: comment.id,
            author: comment.author.name,
            authorId: comment.author.id,
            text: comment.content,
            content: comment.content,
            createdAt: comment.createdAt,
          })),
        })),
    pendingRequests: myMember?.role === 'OWNER' || myMember?.role === 'ADMIN' || req.user.role === 'ADMIN'
      ? team.joinRequests.map((request) => ({
          id: request.id,
          userId: request.user.id,
          userName: request.user.name,
          avatar: request.user.avatar || request.user.name?.charAt(0)?.toUpperCase() || 'U',
          avatarUrl: request.user.avatarUrl,
          date: request.createdAt,
        }))
      : [],
  });
});

// POST /teams/:id/join
router.post('/:id/join', async (req, res) => {
  const team = await prisma.team.findUnique({ where: { id: req.params.id } });
  if (!team) return res.status(404).json({ error: 'Echipă inexistentă' });

  const existingMember = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: req.user.id, teamId: team.id } },
  });
  if (existingMember) {
    return res.json({ ok: true, message: 'Ești deja membru.', activeTeam: team.name, activeTeamId: team.id, refreshSocket: true });
  }

  if (!team.isPublic) {
    await prisma.joinRequest.upsert({
      where: { userId_teamId: { userId: req.user.id, teamId: team.id } },
      create: { userId: req.user.id, teamId: team.id },
      update: { status: 'PENDING' },
    });
    return res.json({ ok: true, message: 'Cerere trimisă', activeTeam: '', activeTeamId: null, refreshSocket: false });
  }

  await prisma.teamMember.upsert({
    where: { userId_teamId: { userId: req.user.id, teamId: team.id } },
    create: { userId: req.user.id, teamId: team.id },
    update: {},
  });

  global.__io?.to(`team:${team.id}`).emit('team:updated', { teamId: team.id });
  global.__io?.to(`user:${req.user.id}`).emit('team:joined', { teamId: team.id });

  res.json({ ok: true, activeTeam: team.name, activeTeamId: team.id, refreshSocket: true });
});

// POST /teams/:id/leave
router.post('/:id/leave', async (req, res) => {
  await prisma.teamMember.deleteMany({ where: { userId: req.user.id, teamId: req.params.id } });
  global.__io?.to(`team:${req.params.id}`).emit('team:updated', { teamId: req.params.id });
  const active = await getActiveTeamSummary(req.user.id);
  res.json({ ok: true, ...active, refreshSocket: true });
});

// PATCH /teams/:id — edit team
router.patch('/:id', async (req, res) => {
  const allowed = await ensureTeamManager(req, res);
  if (!allowed) return;

  const data = {};
  if (req.body?.description !== undefined) data.description = req.body.description ? String(req.body.description) : null;
  if (req.body?.avatarUrl !== undefined) data.avatarUrl = req.body.avatarUrl ? String(req.body.avatarUrl) : null;
  if (req.body?.isPublic !== undefined) {
    data.isPublic = Boolean(req.body.isPublic);
    data.teamType = data.isPublic ? 'FREE' : 'PRIVATE';
  }

  const team = await prisma.team.update({ where: { id: req.params.id }, data });
  res.json(team);
});

// DELETE /teams/:id
router.delete('/:id', async (req, res) => {
  const allowed = await ensureTeamManager(req, res);
  if (!allowed) return;

  await prisma.team.delete({ where: { id: req.params.id } });
  const active = await getActiveTeamSummary(req.user.id);
  res.json({ ok: true, ...active, refreshSocket: true });
});

// POST /teams/:id/requests/:reqId/accept
router.post('/:id/requests/:reqId/accept', async (req, res) => {
  const allowed = await ensureTeamManager(req, res);
  if (!allowed) return;

  const joinRequest = await prisma.joinRequest.findUnique({ where: { id: req.params.reqId } });
  if (!joinRequest || joinRequest.teamId !== req.params.id) {
    return res.status(404).json({ error: 'Cerere inexistentă' });
  }

  const jr = await prisma.joinRequest.update({
    where: { id: req.params.reqId },
    data: { status: 'ACCEPTED' },
  });

  await prisma.teamMember.upsert({
    where: { userId_teamId: { userId: jr.userId, teamId: jr.teamId } },
    create: { userId: jr.userId, teamId: jr.teamId },
    update: {},
  });

  global.__io?.to(`team:${req.params.id}`).emit('team:updated', { teamId: req.params.id });
  global.__io?.to(`user:${jr.userId}`).emit('team:joined', { teamId: jr.teamId });

  res.json({ ok: true });
});

// POST /teams/:id/requests/:reqId/reject
router.post('/:id/requests/:reqId/reject', async (req, res) => {
  const allowed = await ensureTeamManager(req, res);
  if (!allowed) return;

  const joinRequest = await prisma.joinRequest.findUnique({ where: { id: req.params.reqId } });
  if (!joinRequest || joinRequest.teamId !== req.params.id) {
    return res.status(404).json({ error: 'Cerere inexistentă' });
  }

  await prisma.joinRequest.update({ where: { id: req.params.reqId }, data: { status: 'REJECTED' } });
  res.json({ ok: true });
});

// PATCH /teams/:id/members/:userId — promote/demote/kick/remove
router.patch('/:id/members/:userId', async (req, res) => {
  const allowed = await ensureTeamManager(req, res);
  if (!allowed) return;

  const action = String(req.body?.action || '').toLowerCase();
  const targetMembership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: req.params.userId, teamId: req.params.id } },
  });

  if (!targetMembership) return res.status(404).json({ error: 'Membru inexistent' });
  if (targetMembership.role === 'OWNER' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Ownerul nu poate fi modificat din acest ecran.' });
  }

  if (action === 'kick' || action === 'remove') {
    await prisma.teamMember.delete({ where: { userId_teamId: { userId: req.params.userId, teamId: req.params.id } } });
  } else if (action === 'promote' || action === 'demote') {
    const newRole = action === 'promote' ? 'ADMIN' : 'MEMBER';
    await prisma.teamMember.update({
      where: { userId_teamId: { userId: req.params.userId, teamId: req.params.id } },
      data: { role: newRole },
    });
  } else {
    return res.status(400).json({ error: 'Acțiune necunoscută' });
  }

  global.__io?.to(`team:${req.params.id}`).emit('team:updated', { teamId: req.params.id });
  res.json({ ok: true });
});

export default router;
