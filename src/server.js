import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import prisma from './lib/prisma.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import teamRoutes from './routes/teams.js';
import postRoutes from './routes/posts.js';
import messageRoutes from './routes/messages.js';
import chatRoutes from './routes/chat.js';
import coachRoutes from './routes/coach.js';
import nutritionistRoutes from './routes/nutritionist.js';
import adminRoutes from './routes/admin.js';
import athleteRoutes from './routes/athlete.js';
import publicRoutes from './routes/public.js';
import challengesRoutes from './routes/challenges.js';
import searchRoutes from './routes/search.js';
import achievementsRoutes from './routes/achievements.js';
import { verifyToken } from './utils/jwt.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// Allowed origins: explicit list (comma-separated env) + dev defaults.
// Also supports wildcards like "https://*.vercel.app" for Vercel preview deploys.
const staticOrigins = [
  process.env.FRONTEND_URL,
  ...(process.env.FRONTEND_URL_EXTRA ? process.env.FRONTEND_URL_EXTRA.split(',').map((s) => s.trim()) : []),
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
].filter(Boolean);

function originAllowed(origin) {
  if (!origin) return true; // curl / same-origin
  if (process.env.NODE_ENV !== 'production') return true;
  for (const allowed of staticOrigins) {
    if (allowed === '*') return true;
    if (allowed === origin) return true;
    if (allowed.includes('*')) {
      const rx = new RegExp('^' + allowed.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (rx.test(origin)) return true;
    }
  }
  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (originAllowed(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
};

const io = new SocketIOServer(server, {
  cors: {
    origin(origin, callback) {
      if (originAllowed(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked: ${origin}`));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 30000,
  pingInterval: 10000,
});

global.__io = io;

io.use(async (socket, next) => {
  const token = socket.handshake?.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, role: true, avatar: true, avatarUrl: true },
    });
    if (!user) return next(new Error('User not found'));
    socket.user = user;
    next();
  } catch {
    next(new Error('Token invalid'));
  }
});

io.on('connection', async (socket) => {
  const user = socket.user;
  if (!user) return;
  socket.join(`user:${user.id}`);

  try {
    const memberships = await prisma.teamMember.findMany({ where: { userId: user.id }, select: { teamId: true } });
    memberships.forEach((membership) => socket.join(`team:${membership.teamId}`));
  } catch (error) {
    console.error('[socket] join rooms error', error);
  }

  socket.on('disconnect', () => {});
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ══ ALL ROUTES UNDER /api ══
const api = express.Router();
app.use('/api', api);

api.use('/auth', authRoutes);
api.use('/', publicRoutes);

// ══ AUTHENTICATED ROUTES ══
// User & dashboard
api.use('/user', userRoutes);
api.use('/dashboard', (req, res, next) => { req.url = '/dashboard'; next(); }, userRoutes);
api.use('/goals', (req, res, next) => { req.url = '/goals'; next(); }, userRoutes);

// Teams
api.use('/teams', teamRoutes);

// Posts / Feed
api.use('/feed', postRoutes);

// Messages (DM)
api.use('/messages', messageRoutes);

// Chat (team chat)
api.use('/chat', chatRoutes);

// Coach
api.use('/coach', coachRoutes);

// Nutritionist
api.use('/nutritionist', nutritionistRoutes);

// Admin
api.use('/admin', adminRoutes);

// Athlete-specific (sleep, meals, exercises, workouts, discover, contact)
api.use('/sleep', (req, res, next) => { req.url = '/sleep' + req.url; next(); }, athleteRoutes);
api.use('/meals', (req, res, next) => { req.url = '/meals' + req.url; next(); }, athleteRoutes);
api.use('/exercises', (req, res, next) => { req.url = '/exercises' + req.url; next(); }, athleteRoutes);
api.use('/workout', (req, res, next) => { req.url = '/workout' + req.url; next(); }, athleteRoutes);
api.use('/discover', (req, res, next) => { req.url = `/discover${req.url === '/' ? '' : req.url}`; next(); }, athleteRoutes);
api.use('/contact', (req, res, next) => { req.url = '/contact'; next(); }, athleteRoutes);
api.use('/food', (req, res, next) => { req.url = '/food' + req.url; next(); }, athleteRoutes);
api.use('/today', (req, res, next) => { req.url = '/today' + req.url; next(); }, athleteRoutes);
api.use('/challenges', challengesRoutes);
api.use('/search', searchRoutes);
api.use('/achievements', achievementsRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Rută inexistentă: ${req.method} ${req.originalUrl}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Eroare internă server' });
});

server.listen(PORT, () => {
  console.log(`🚀 FORJA Backend on port ${PORT}`);
  console.log(`   Health:   http://localhost:${PORT}/health`);
  console.log(`   Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});
