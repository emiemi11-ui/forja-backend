import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { buildAchievementsPayload } from '../utils/achievements.js';
import prisma from '../lib/prisma.js';

const router = Router();

router.use(authenticate);

router.get('/', async (req, res) => {
  const payload = await buildAchievementsPayload(prisma, req.user.id);
  res.json(payload);
});

export default router;
