import { Router } from 'express';
import { getAppSettings } from '../utils/appSettings.js';
import prisma from '../lib/prisma.js';

const router = Router();

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function cleanText(value = '') {
  return String(value || '').trim();
}

router.get('/settings/public', async (req, res) => {
  const settings = await getAppSettings(prisma);
  res.json({
    settings: {
      allowPublicSignup: settings.allowPublicSignup,
      allowWaitlist: settings.allowWaitlist,
      allowContact: settings.allowContact,
      maintenanceMode: settings.maintenanceMode,
    },
  });
});

router.post('/contact', async (req, res) => {
  const settings = await getAppSettings(prisma);
  if (!settings.allowContact) {
    return res.status(403).json({ error: 'Formularul de contact este dezactivat momentan.' });
  }

  const name = cleanText(req.body?.name);
  const email = normalizeEmail(req.body?.email);
  const subject = cleanText(req.body?.subject || req.body?.topic || 'general');
  const message = cleanText(req.body?.message);
  const type = cleanText(req.body?.type || 'contact') || 'contact';

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Completează numele, emailul și mesajul.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Email invalid.' });
  }

  const submission = await prisma.contactSubmission.create({
    data: {
      name,
      email,
      subject,
      message,
      type,
      status: 'nou',
    },
  });

  // Notifica admini in real-time
  global.__io?.to('admins').emit('inbox:new', {
    kind: 'contact',
    submission: { id: submission.id, name, email, subject, type, createdAt: submission.createdAt },
  });

  res.status(201).json({ ok: true, id: submission.id });
});

router.post('/waitlist', async (req, res) => {
  const settings = await getAppSettings(prisma);
  if (!settings.allowWaitlist) {
    return res.status(403).json({ error: 'Lista de așteptare este închisă momentan.' });
  }

  const email = normalizeEmail(req.body?.email);
  const rawType = cleanText(req.body?.type || 'app');
  if (!email) return res.status(400).json({ error: 'Email obligatoriu.' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email invalid.' });

  const normalizedType = rawType ? `waitlist:${rawType}` : 'waitlist:app';
  const existing = await prisma.contactSubmission.findFirst({
    where: { email, type: normalizedType },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return res.json({ ok: true, id: existing.id, duplicate: true });
  }

  const submission = await prisma.contactSubmission.create({
    data: {
      name: req.body?.name ? cleanText(req.body.name) : 'Waitlist',
      email,
      subject: cleanText(req.body?.subject || 'waitlist') || 'waitlist',
      message: cleanText(req.body?.message || `Înscriere în waitlist (${rawType || 'app'})`) || `Înscriere în waitlist (${rawType || 'app'})`,
      type: normalizedType,
      status: 'nou',
    },
  });

  // Notifica admini real-time
  global.__io?.to('admins').emit('inbox:new', {
    kind: 'waitlist',
    submission: { id: submission.id, email, type: normalizedType, createdAt: submission.createdAt },
  });

  res.status(201).json({ ok: true, id: submission.id });
});

export default router;
