import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePro } from '../middleware/planCheck.js';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(authenticate);

// Restrictionari pentru initiere DM:
// - USER (atlet): trebuie sa fie pe plan PRO sau TEAM
// - COACH/NUTRITIONIST: pot initia oricand
// - ADMIN: poate initia DM DOAR catre COACH sau NUTRITIONIST
async function checkDmStartAllowed(req, res, next) {
  // Atletii (USER) au nevoie de PRO+
  if (req.user.role === 'USER') return requirePro(req, res, next);

  // Admin -> verificam tinta
  if (req.user.role === 'ADMIN') {
    const targetId = req.body?.targetUserId;
    if (!targetId) return res.status(400).json({ error: 'Utilizator țintă invalid' });
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { role: true } });
    if (!target) return res.status(404).json({ error: 'Utilizator inexistent' });
    if (target.role !== 'COACH' && target.role !== 'NUTRITIONIST') {
      return res.status(403).json({
        error: 'admin_dm_restricted',
        message: 'Adminul poate trimite mesaje doar către coach și nutriționist.',
      });
    }
    return next();
  }

  // Coach + Nutritionist -> liber
  return next();
}

function formatMessage(message, currentUserId) {
  return {
    id: message.id,
    message: message.content,
    isMe: message.senderId === currentUserId,
    createdAt: message.createdAt,
    time: new Date(message.createdAt).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
    seen: Boolean(message.read),
  };
}

// GET /messages/unread/count
router.get('/unread/count', async (req, res) => {
  const count = await prisma.message.count({
    where: {
      conversation: { OR: [{ user1Id: req.user.id }, { user2Id: req.user.id }] },
      senderId: { not: req.user.id },
      read: false,
    },
  });
  res.json({ unread: count });
});

// GET /messages/conversations
router.get('/conversations', async (req, res) => {
  const convos = await prisma.conversation.findMany({
    where: { OR: [{ user1Id: req.user.id }, { user2Id: req.user.id }] },
    include: {
      user1: { select: { id: true, name: true, role: true, avatar: true, avatarUrl: true } },
      user2: { select: { id: true, name: true, role: true, avatar: true, avatarUrl: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const payload = await Promise.all(convos.map(async (convo) => {
    const other = convo.user1Id === req.user.id ? convo.user2 : convo.user1;
    const unread = await prisma.message.count({
      where: {
        conversationId: convo.id,
        senderId: { not: req.user.id },
        read: false,
      },
    });
    return {
      id: convo.id,
      other: {
        id: other.id,
        name: other.name,
        role: other.role,
        avatar: other.avatar,
        avatarUrl: other.avatarUrl,
        isOnline: global.__onlineUsers?.has(other.id) || false,
      },
      lastMessage: convo.messages[0]?.content || '',
      lastAt: convo.messages[0]?.createdAt || convo.updatedAt,
      unread,
    };
  }));

  res.json(payload);
});

// POST /messages/start
router.post('/start', checkDmStartAllowed, async (req, res) => {
  const { targetUserId } = req.body;
  if (!targetUserId || targetUserId === req.user.id) {
    return res.status(400).json({ error: 'Utilizator țintă invalid' });
  }
  const [user1Id, user2Id] = [req.user.id, targetUserId].sort();
  let convo = await prisma.conversation.findUnique({ where: { user1Id_user2Id: { user1Id, user2Id } } });
  if (!convo) convo = await prisma.conversation.create({ data: { user1Id, user2Id } });
  res.json({ conversationId: convo.id });
});

// GET /messages/:id
router.get('/:id', async (req, res) => {
  const convo = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 100 },
      user1: { select: { id: true, name: true, role: true, avatar: true, avatarUrl: true } },
      user2: { select: { id: true, name: true, role: true, avatar: true, avatarUrl: true } },
    },
  });
  if (!convo) return res.status(404).json({ error: 'Conversație inexistentă' });
  if (![convo.user1Id, convo.user2Id].includes(req.user.id)) {
    return res.status(403).json({ error: 'Acces interzis' });
  }
  const other = convo.user1Id === req.user.id ? convo.user2 : convo.user1;
  // Marcheaza ca read TOATE mesajele primite de la celalalt user
  const updateResult = await prisma.message.updateMany({
    where: { conversationId: convo.id, senderId: { not: req.user.id }, read: false },
    data: { read: true },
  });
  // Notifica sender-ul ca mesajele lui au fost vazute
  if (updateResult.count > 0) {
    global.__io?.to(`user:${other.id}`).emit('messages:seen', {
      conversationId: convo.id,
      seenBy: req.user.id,
    });
  }
  // Status online real
  const isOnline = global.__onlineUsers?.has(other.id) || false;
  res.json({
    conversation: {
      id: convo.id,
      other: { ...other, isOnline },
    },
    messages: convo.messages.map((message) => formatMessage(message, req.user.id)),
  });
});

// POST /messages/:id — send message
router.post('/:id', async (req, res) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
  if (!conversation) return res.status(404).json({ error: 'Conversație inexistentă' });
  if (![conversation.user1Id, conversation.user2Id].includes(req.user.id)) {
    return res.status(403).json({ error: 'Acces interzis' });
  }
  const text = String(req.body.message || '').trim();
  if (!text) return res.status(400).json({ error: 'Mesaj gol' });

  const msg = await prisma.message.create({
    data: { content: text, senderId: req.user.id, conversationId: req.params.id },
  });
  await prisma.conversation.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });

  const payload = formatMessage(msg, req.user.id);
  const recipientId = conversation.user1Id === req.user.id ? conversation.user2Id : conversation.user1Id;
  global.__io?.to(`user:${recipientId}`).emit('dm:new', {
    conversationId: conversation.id,
    message: formatMessage(msg, recipientId),
  });
  global.__io?.to(`user:${req.user.id}`).emit('dm:new', {
    conversationId: conversation.id,
    message: payload,
  });

  res.status(201).json(payload);
});

export default router;
