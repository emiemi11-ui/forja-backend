import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { signToken } from '../utils/jwt.js';
import { getAppSettings } from '../utils/appSettings.js';
import { signupCheck } from '../middleware/appSettings.js';
import prisma from '../lib/prisma.js';

const router = Router();

const ROLE_REDIRECTS = {
  USER: '/app',
  COACH: '/coach',
  NUTRITIONIST: '/nutritionist',
  ADMIN: '/admin',
};

// POST /auth/register
router.post('/register', signupCheck, async (req, res) => {
  try {
    const { name, email, password, role, plan, extra } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Numele, emailul și parola sunt obligatorii' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(409).json({ error: 'Există deja un cont cu acest email' });
    }

    const normalizedRole = String(role || 'USER').trim().toUpperCase();
    const normalizedPlan = String(plan || '').trim().toUpperCase();
    const roleAliases = {
      ATHLETE: 'USER',
      USER: 'USER',
      COACH: 'COACH',
      NUTRITIONIST: 'NUTRITIONIST',
      NUT: 'NUTRITIONIST',
      ADMIN: 'ADMIN',
    };
    const planAliases = {
      STARTER: 'FREE',
      FREE: 'FREE',
      PRO: 'PRO',
      TEAM: 'TEAM',
      COACH: 'COACH',
      NUT: 'NUT',
      'NUT.': 'NUT',
      NUTRITIONIST: 'NUT',
    };

    const requestedRole = roleAliases[normalizedRole] || 'USER';
    const [settings, realUsersCount, realAdminsCount] = await Promise.all([
      getAppSettings(prisma),
      prisma.user.count({ where: { isDemo: false } }),
      prisma.user.count({ where: { role: 'ADMIN', isDemo: false } }),
    ]);
    const bootstrapKey = req.body?.adminBootstrapKey || req.headers['x-admin-bootstrap-key'];
    const bootstrapKeyMatches = Boolean(
      process.env.ADMIN_BOOTSTRAP_KEY &&
      bootstrapKey &&
      bootstrapKey === process.env.ADMIN_BOOTSTRAP_KEY
    );
    const requestedAdmin = requestedRole === 'ADMIN';
    const canBootstrapAdmin = requestedAdmin && (
      realUsersCount === 0 ||
      (realAdminsCount === 0 && bootstrapKeyMatches)
    );

    if (requestedAdmin && !canBootstrapAdmin) {
      return res.status(403).json({
        error: realAdminsCount > 0
          ? 'Există deja un administrator real. Creează contul cu alt rol.'
          : 'Crearea primului administrator necesită cheia de bootstrap.',
      });
    }

    if (!settings.allowPublicSignup && !canBootstrapAdmin) {
      return res.status(403).json({ error: 'Înregistrările publice sunt închise momentan.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    let validRole = ['USER', 'COACH', 'NUTRITIONIST'].includes(requestedRole)
      ? requestedRole
      : 'USER';
    if (canBootstrapAdmin) validRole = 'ADMIN';

    const defaultPlanByRole = {
      USER: 'FREE',
      COACH: 'COACH',
      NUTRITIONIST: 'NUT',
      ADMIN: 'PRO',
    };
    const validPlan = planAliases[normalizedPlan] || defaultPlanByRole[validRole] || 'FREE';

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: validRole,
        plan: validPlan,
        avatar: name.trim()[0].toUpperCase(),
        bio: extra?.bio || null,
        specialization: extra?.specialization || null,
        certifications: extra?.certifications || null,
        experience: extra?.experience ? parseInt(extra.experience) : null,
        goal: extra?.goal || null,
        weight: extra?.weight ? parseFloat(extra.weight) : null,
        height: extra?.height ? parseFloat(extra.height) : null,
        isDemo: false,
      },
    });

    // Create default goals
    await prisma.userGoals.create({
      data: { userId: user.id },
    });

    const token = signToken({ userId: user.id, role: user.role });
    const { password: _, ...safeUser } = user;

    res.status(201).json({
      ok: true,
      token,
      user: safeUser,
      redirect: ROLE_REDIRECTS[user.role] || '/app',
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Eroare la crearea contului' });
  }
});

// POST /auth/login
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Introdu un email valid.' });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, blocked: true },
  });

  if (user) {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PASSWORD_RESET_REQUEST',
        type: 'auth',
        status: user.blocked ? 'WARNING' : 'INFO',
        detail: JSON.stringify({ email: user.email, role: user.role, source: 'login-page' }),
      },
    });
  }

  res.json({
    ok: true,
    message: 'Dacă există un cont pe acest email, cererea de resetare a fost înregistrată.',
  });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'Email și parolă obligatorii' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) {
      return res.status(401).json({ error: 'Email sau parolă greșite' });
    }
    if (user.blocked) {
      return res.status(403).json({ error: 'Contul este blocat. Contactează administratorul.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Email sau parolă greșite' });
    }

    // Audit the login
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        type: 'auth',
        status: 'SUCCESS',
        detail: `${user.role} login`,
      },
    }).catch(() => {});

    // Update streak — DOAR dacă userul nu a mai fost activ azi
    let newStreak = user.streak || 0;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last = user.lastActiveDate ? new Date(user.lastActiveDate) : null;
    const lastDay = last ? new Date(last.getFullYear(), last.getMonth(), last.getDate()) : null;

    if (!lastDay) {
      // Prima activitate — încep streak la 1
      newStreak = 1;
    } else {
      const diffDays = Math.round((today - lastDay) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) {
        // Azi am mai fost activ — nu schimb streak
      } else if (diffDays === 1) {
        // Activ ieri — continui streak
        newStreak = (user.streak || 0) + 1;
      } else {
        // Pauză de 2+ zile — restart streak
        newStreak = 1;
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        streak: newStreak,
        lastActiveDate: now,
      },
    });

    const token = signToken({ userId: user.id, role: user.role });
    const { password: _, ...safeUser } = user;

    // Force isDemo:false in response — the frontend's client.js uses the
    // user.isDemo flag to activate mock mode. Our seeded accounts have
    // isDemo:true in the DB, but once logged in with a real token, the
    // frontend should call the real API.
    res.json({
      ok: true,
      token,
      user: { ...safeUser, streak: newStreak, isDemo: false },
      redirect: ROLE_REDIRECTS[user.role] || '/app',
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Eroare la autentificare' });
  }
});

// GET /auth/me — current user
router.get('/me', async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Neautentificat' });
  try {
    const { verifyToken } = await import('../utils/jwt.js');
    const decoded = verifyToken(header.slice(7));
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(404).json({ error: 'Utilizator inexistent' });
    const { password: _, ...safeUser } = user;
    // Same override as /login — see comment above.
    res.json({ ...safeUser, isDemo: false });
  } catch {
    res.status(401).json({ error: 'Token invalid' });
  }
});

export default router;
