// Password hashing (scrypt, no external dep) + cookie session helpers.
import crypto from 'node:crypto';
import { db } from './db.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(':');
    if (scheme !== 'scrypt') return false;
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(test, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const COOKIE = 'ld_session';

export function issueSession(reply, adminId) {
  // @fastify/cookie signs the value with SESSION_SECRET.
  reply.setCookie(COOKIE, String(adminId), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export function clearSession(reply) {
  reply.clearCookie(COOKIE, { path: '/' });
}

export function currentAdmin(request) {
  const raw = request.cookies?.[COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return db.prepare('SELECT id, email, name FROM admins WHERE id = ?').get(unsigned.value) || null;
}

// Fastify preHandler guard for admin-only routes.
export function requireAdmin(request, reply, done) {
  const admin = currentAdmin(request);
  if (!admin) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  request.admin = admin;
  done();
}
