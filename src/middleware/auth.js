import { verifyToken } from '../utils/jwt.js';
import prisma from '../lib/prisma.js';


export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token lipsă' });
  }
  try {
    const decoded = verifyToken(header.slice(7));
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ error: 'Utilizator inexistent' });
    if (user.blocked) return res.status(403).json({ error: 'Cont blocat' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalid sau expirat' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Neautentificat' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acces interzis pentru rolul tău' });
    }
    next();
  };
}
