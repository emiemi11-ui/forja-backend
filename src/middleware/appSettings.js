import prisma from '../lib/prisma.js';
import { getAppSettings } from '../utils/appSettings.js';

// Cache 30s to avoid hitting DB on every request
let _cache = null;
let _cacheExpiry = 0;

async function loadSettings() {
  const now = Date.now();
  if (_cache && now < _cacheExpiry) return _cache;
  try {
    _cache = await getAppSettings(prisma);
    _cacheExpiry = now + 30 * 1000;
    return _cache;
  } catch {
    return {
      maintenanceMode: false,
      allowPublicSignup: true,
      allowWaitlist: true,
      allowContact: true,
    };
  }
}

export function invalidateSettingsCache() {
  _cache = null;
  _cacheExpiry = 0;
}

// Blocks all /api/* requests when maintenance is ON, except auth/admin/health
export async function maintenanceCheck(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/admin')) return next();
  if (req.path.startsWith('/auth')) return next();

  const settings = await loadSettings();
  if (!settings.maintenanceMode) return next();

  if (req.user?.role === 'ADMIN') return next();

  return res.status(503).json({
    error: 'maintenance',
    message: 'Platforma este în mentenanță. Asta înseamnă că de la login în colo nu se mai poate utiliza. Revenim curând!',
  });
}

export async function signupCheck(req, res, next) {
  const settings = await loadSettings();
  if (!settings.allowPublicSignup) {
    return res.status(403).json({
      error: 'signup_disabled',
      message: 'Înregistrările sunt momentan închise. Revino mai târziu!',
    });
  }
  return next();
}

export async function waitlistCheck(req, res, next) {
  const settings = await loadSettings();
  if (!settings.allowWaitlist) {
    return res.status(403).json({
      error: 'waitlist_closed',
      message: 'Lista de așteptare e închisă momentan',
    });
  }
  return next();
}

export async function contactCheck(req, res, next) {
  const settings = await loadSettings();
  if (!settings.allowContact) {
    return res.status(403).json({
      error: 'contact_closed',
      message: 'Formularul de contact e închis momentan',
    });
  }
  return next();
}
