import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(authenticate);

async function getTeamManagerRole(teamId, userId) {
  if (!teamId) return null;
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { role: true },
  });
  return membership?.role || null;
}

async function canManagePost(post, user) {
  if (!post || !user) return false;
  if (user.role === 'ADMIN') return true;
  if (post.authorId === user.id) return true;
  if (post.teamId) {
    const role = await getTeamManagerRole(post.teamId, user.id);
    return ['OWNER', 'ADMIN'].includes(role || '');
  }
  return false;
}

// Decorate a list of posts with per-user `liked` + serialised comments.
async function decoratePosts(rawPosts, currentUserId) {
  const ids = rawPosts.map((p) => p.id);
  const likedSet = new Set();
  if (ids.length && currentUserId) {
    const myLikes = await prisma.like.findMany({
      where: { postId: { in: ids }, userId: currentUserId },
      select: { postId: true },
    });
    myLikes.forEach((row) => likedSet.add(row.postId));
  }
  return rawPosts.map((post) => ({
    id: post.id,
    author: post.author?.name,
    authorId: post.author?.id,
    avatar: post.author?.avatar || post.author?.name?.[0]?.toUpperCase() || 'U',
    avatarUrl: post.author?.avatarUrl,
    teamId: post.team?.id || null,
    teamName: post.team?.name || '',
    content: post.content,
    img: post.imageUrl || '',
    likes: post.likes,
    liked: likedSet.has(post.id),
    comments: (post.comments || []).map((comment) => ({
      id: comment.id,
      author: comment.author?.name,
      authorId: comment.author?.id,
      content: comment.content,
      text: comment.content,
      createdAt: comment.createdAt,
    })),
    createdAt: post.createdAt,
  }));
}

// GET /feed
router.get('/', async (req, res) => {
  const myTeams = await prisma.teamMember.findMany({
    where: { userId: req.user.id },
    select: { teamId: true },
  });
  const teamIds = myTeams.map((team) => team.teamId);

  const posts = await prisma.post.findMany({
    where: {
      OR: [
        { teamId: null },
        { teamId: { in: teamIds } },
        { authorId: req.user.id },
      ],
    },
    include: {
      author: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      team: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  const payload = await decoratePosts(posts, req.user.id);
  res.json(payload);
});

// POST /feed — create post
router.post('/', async (req, res) => {
  const { content, teamId, imageUrl } = req.body || {};
  const cleanContent = String(content || '').trim();
  if (!cleanContent) return res.status(400).json({ error: 'Conținutul postării este obligatoriu.' });

  if (teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId: req.user.id, teamId } },
    });
    if (!membership && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Doar membrii echipei pot posta aici.' });
    }
  }

  const created = await prisma.post.create({
    data: {
      content: cleanContent,
      authorId: req.user.id,
      teamId: teamId || null,
      imageUrl: imageUrl || null,
    },
    include: {
      author: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
      comments: true,
      team: { select: { id: true, name: true } },
    },
  });

  const [serialized] = await decoratePosts([created], req.user.id);

  if (created.teamId) {
    global.__io?.to(`team:${created.teamId}`).emit('feed:new', { teamId: created.teamId, post: serialized });
  } else {
    global.__io?.emit('feed:new', { post: serialized });
  }

  res.status(201).json(serialized);
});

// POST /feed/:id/like — toggle
router.post('/:id/like', async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: 'Postare inexistentă' });

  const existing = await prisma.like.findUnique({
    where: { postId_userId: { postId: post.id, userId: req.user.id } },
  });

  let liked;
  if (existing) {
    await prisma.$transaction([
      prisma.like.delete({ where: { postId_userId: { postId: post.id, userId: req.user.id } } }),
      prisma.post.update({ where: { id: post.id }, data: { likes: { decrement: 1 } } }),
    ]);
    liked = false;
  } else {
    await prisma.$transaction([
      prisma.like.create({ data: { postId: post.id, userId: req.user.id } }),
      prisma.post.update({ where: { id: post.id }, data: { likes: { increment: 1 } } }),
    ]);
    liked = true;
  }

  const fresh = await prisma.post.findUnique({ where: { id: post.id }, select: { likes: true } });
  const likesCount = fresh?.likes ?? 0;

  const payload = { postId: post.id, likes: likesCount };
  if (post.teamId) {
    global.__io?.to(`team:${post.teamId}`).emit('feed:like', payload);
  } else {
    global.__io?.emit('feed:like', payload);
  }

  res.json({ ok: true, liked, likes: likesCount });
});

// POST /feed/:id/comment
router.post('/:id/comment', async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: 'Postare inexistentă' });

  if (post.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId: req.user.id, teamId: post.teamId } },
    });
    if (!membership && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Doar membrii echipei pot comenta aici.' });
    }
  }

  const cleanContent = String(req.body?.content || '').trim();
  if (!cleanContent) return res.status(400).json({ error: 'Comentariul este gol.' });

  const created = await prisma.comment.create({
    data: { content: cleanContent, authorId: req.user.id, postId: req.params.id },
    include: { author: { select: { id: true, name: true } } },
  });

  const serialized = {
    id: created.id,
    author: created.author?.name,
    authorId: created.author?.id,
    content: created.content,
    text: created.content,
    createdAt: created.createdAt,
  };

  const payload = { postId: post.id, comment: serialized };
  if (post.teamId) {
    global.__io?.to(`team:${post.teamId}`).emit('feed:comment', payload);
  } else {
    global.__io?.emit('feed:comment', payload);
  }

  res.status(201).json(serialized);
});

// DELETE /feed/comments/:id
router.delete('/comments/:id', async (req, res) => {
  const comment = await prisma.comment.findUnique({
    where: { id: req.params.id },
    include: { post: true },
  });
  if (!comment) return res.status(404).json({ error: 'Comentariu inexistent' });

  const canDelete = req.user.role === 'ADMIN'
    || comment.authorId === req.user.id
    || comment.post.authorId === req.user.id
    || (comment.post.teamId ? ['OWNER', 'ADMIN'].includes((await getTeamManagerRole(comment.post.teamId, req.user.id)) || '') : false);

  if (!canDelete) {
    return res.status(403).json({ error: 'Nu poți șterge acest comentariu.' });
  }

  await prisma.comment.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// DELETE /feed/:id
router.delete('/:id', async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: 'Postare inexistentă' });

  const allowed = await canManagePost(post, req.user);
  if (!allowed) return res.status(403).json({ error: 'Nu poți șterge această postare.' });

  await prisma.post.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
