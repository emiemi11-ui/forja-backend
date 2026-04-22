import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(authenticate);

async function canAccessTeam(teamId, user) {
  if (!teamId) return false;
  if (user?.role === 'ADMIN') return true;
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: user.id, teamId } },
    select: { id: true },
  });
  return Boolean(membership);
}

function toChatMessage(message, currentUserId) {
  return {
    id: message.id,
    from: message.sender?.name || message.senderName || '',
    sender: message.sender?.name || message.senderName || '',
    avatar: message.sender?.avatarUrl || message.sender?.avatar || message.avatar || '',
    msg: message.content || message.text || message.msg || '',
    text: message.content || message.text || message.msg || '',
    time: new Date(message.createdAt || Date.now()).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
    senderId: message.senderId,
    isMe: message.senderId === currentUserId,
  };
}

// GET /chat
router.get('/', async (req, res) => {
  const teamId = req.query.teamId;
  let team;
  if (teamId) {
    const allowed = await canAccessTeam(teamId, req.user);
    if (allowed) {
      team = await prisma.team.findUnique({ where: { id: teamId }, include: { _count: { select: { members: true } } } });
    }
  } else {
    const first = await prisma.teamMember.findFirst({
      where: { userId: req.user.id },
      include: { team: { include: { _count: { select: { members: true } } } } },
    });
    team = first?.team;
  }

  if (!team) return res.json({ teamName: '', teamId: null, membersCount: 0, messages: [] });

  const messages = await prisma.chatMessage.findMany({
    where: { teamId: team.id },
    include: { sender: { select: { name: true, avatar: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  res.json({
    teamName: team.name,
    teamId: team.id,
    membersCount: team._count.members,
    messages: messages.map((message) => toChatMessage(message, req.user.id)),
  });
});

// POST /chat
router.post('/', async (req, res) => {
  const text = String(req.body.msg || '').trim();
  if (!text) return res.status(400).json({ error: 'Mesaj gol' });
  let teamId = req.body.teamId;
  if (!teamId) {
    const first = await prisma.teamMember.findFirst({ where: { userId: req.user.id } });
    teamId = first?.teamId;
  }
  if (!teamId) return res.status(400).json({ error: 'Nu ești în nicio echipă' });
  if (!(await canAccessTeam(teamId, req.user))) {
    return res.status(403).json({ error: 'Nu ai acces la chat-ul acestei echipe' });
  }

  const created = await prisma.chatMessage.create({
    data: { content: text, senderId: req.user.id, teamId },
    include: { sender: { select: { name: true, avatar: true, avatarUrl: true } } },
  });

  const payload = toChatMessage(created, req.user.id);
  // Emit to team room — other members see isMe:false, sender's other devices see isMe:true.
  const broadcastPayload = { ...payload, teamId, isMe: false };
  global.__io?.to(`team:${teamId}`).except(req.user.id ? `user:${req.user.id}` : '').emit('chat:new', broadcastPayload);
  global.__io?.to(`user:${req.user.id}`).emit('chat:new', { ...payload, teamId });
  res.status(201).json(payload);
});

export default router;
