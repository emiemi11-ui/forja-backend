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
import upgradeRoutes from './routes/upgrade.js';
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
  'https://*.vercel.app',
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

// Set of currently connected user IDs (for online presence)
global.__onlineUsers = global.__onlineUsers || new Set();
// Map userId -> count of socket connections (a user may have multiple tabs open)
global.__onlineConnections = global.__onlineConnections || new Map();

io.on('connection', async (socket) => {
  const user = socket.user;
  if (!user) return;
  socket.join(`user:${user.id}`);

  // Track online presence
  const prevCount = global.__onlineConnections.get(user.id) || 0;
  global.__onlineConnections.set(user.id, prevCount + 1);
  if (prevCount === 0) {
    global.__onlineUsers.add(user.id);
    // Inform everyone (the user was offline -> now online)
    io.emit('presence:online', { userId: user.id });
  }

  try {
    const memberships = await prisma.teamMember.findMany({ where: { userId: user.id }, select: { teamId: true } });
    memberships.forEach((membership) => socket.join(`team:${membership.teamId}`));
  } catch (error) {
    console.error('[socket] join rooms error', error);
  }

  socket.on('disconnect', () => {
    const cur = global.__onlineConnections.get(user.id) || 1;
    if (cur <= 1) {
      global.__onlineConnections.delete(user.id);
      global.__onlineUsers.delete(user.id);
      io.emit('presence:offline', { userId: user.id });
    } else {
      global.__onlineConnections.set(user.id, cur - 1);
    }
  });
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ══ ALL ROUTES UNDER /api ══
const api = express.Router();
app.use('/api', api);

// Maintenance check (skips /auth, /admin, /health internally)
import { maintenanceCheck } from './middleware/appSettings.js';
api.use(maintenanceCheck);

// Public + auth routes
api.use('/auth', authRoutes);
api.use('/', publicRoutes);

// ══ AUTHENTICATED ROUTES ══

// Alias router helper.
// We can't simply `api.use('/dashboard', userRoutes)` because userRoutes also
// handles `/avatar`, `/goals`, etc. and Express gets confused with prefix
// concatenation when the same router is mounted multiple times. Instead we
// build tiny passthrough routers that rewrite req.url correctly before
// delegating to the real router.
function aliasRouter(targetRouter, internalPath) {
  const r = express.Router({ mergeParams: true });
  r.use((req, res, next) => {
    // Express has stripped the mount prefix, so req.url currently is "/"
    // or "/<sub>". Build the path the inner router expects.
    const sub = req.url === '/' ? '' : req.url;
    req.url = internalPath + sub;
    return targetRouter(req, res, next);
  });
  return r;
}

// User profile + avatar
api.use('/user', userRoutes);

// Dashboard alias → forwards GET /api/dashboard to userRoutes.GET /dashboard
api.use('/dashboard', aliasRouter(userRoutes, '/dashboard'));

// Goals alias → forwards /api/goals (GET/PUT) to userRoutes.* /goals
api.use('/goals', aliasRouter(userRoutes, '/goals'));

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
// athleteRoutes uses full paths like `/sleep`, `/meals/:id`, `/workout/current`,
// so we use alias routers that prepend the correct prefix before delegating.
api.use('/sleep', aliasRouter(athleteRoutes, '/sleep'));
api.use('/meals', aliasRouter(athleteRoutes, '/meals'));
api.use('/exercises', aliasRouter(athleteRoutes, '/exercises'));
api.use('/workout', aliasRouter(athleteRoutes, '/workout'));
api.use('/discover', aliasRouter(athleteRoutes, '/discover'));
api.use('/food', aliasRouter(athleteRoutes, '/food'));
api.use('/today', aliasRouter(athleteRoutes, '/today'));
api.use('/contact', aliasRouter(athleteRoutes, '/contact'));

// Challenges, search, achievements
api.use('/challenges', challengesRoutes);
api.use('/search', searchRoutes);
api.use('/achievements', achievementsRoutes);
api.use('/upgrade', upgradeRoutes);

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
