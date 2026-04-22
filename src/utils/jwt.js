import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'forja-dev-secret';
const EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
