'use strict';
const crypto = require('node:crypto');
const { one, run, getSettings } = require('./db');
const { HttpError, nowLocal, randomToken, sha256 } = require('./util');

const COOKIE = 'rl_sid';
const SESSION_MS = 12 * 60 * 60 * 1000; // one long shift
const ROLES = ['admin', 'manager', 'cashier'];

// ---------- Passwords (scrypt) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}
function checkPasswordStrength(pw) {
  const s = String(pw || '');
  if (s.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) throw new HttpError(400, 'Password must contain letters and numbers');
  return s;
}

// ---------- Cookies ----------
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}
function setSessionCookie(req, res, token, maxAgeMs) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

// ---------- Sessions ----------
function createSession(req, res, userId) {
  const token = randomToken(32);
  const tz = getSettings().timezone;
  run('INSERT INTO sessions(token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES(?,?,?,?,?,?)',
    sha256(token), userId, nowLocal(tz), Date.now() + SESSION_MS, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 250));
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  setSessionCookie(req, res, token, SESSION_MS);
}
function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  setSessionCookie(req, res, '', 0);
}

const USER_SQL = `
  SELECT u.id, u.username, u.full_name, u.role, u.branch_id, u.active, u.is_demo, u.last_login_at,
         b.name AS branch_name, b.short_name AS branch_short, b.code AS branch_code
  FROM users u LEFT JOIN branches b ON b.id = u.branch_id`;

function loadSessionUser(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const hash = sha256(token);
  const sess = one('SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = ?', hash);
  if (!sess || sess.expires_at < Date.now()) return null;
  const user = one(`${USER_SQL} WHERE u.id = ?`, sess.user_id);
  if (!user || !user.active) return null;
  // Sliding renewal once half the session has elapsed.
  if (sess.expires_at - Date.now() < SESSION_MS / 2) {
    run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', Date.now() + SESSION_MS, hash);
    setSessionCookie(req, res, token, SESSION_MS);
  }
  return user;
}

// ---------- Middleware ----------
function attachUser(req, res, next) {
  req.user = loadSessionUser(req, res);
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  next();
}
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission for this action'));
  next();
};
// Blocks cross-site form posts: every state-changing API call must carry our header.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'RoyalLoyalty') return next(new HttpError(403, 'Request blocked'));
  next();
}

// Users locked to a branch (manager/cashier) only ever see that branch.
function scopedBranch(req, requested) {
  if (req.user.branch_id && req.user.role !== 'admin') return req.user.branch_id;
  const id = Number(requested);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------- Login throttling ----------
const attempts = new Map();
function throttleLogin(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, first: now };
  if (now - rec.first > 10 * 60 * 1000) { rec.count = 0; rec.first = now; }
  if (rec.count >= 8) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  rec.count++;
  attempts.set(key, rec);
}
const clearThrottle = (key) => attempts.delete(key);

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64);
}

function audit(req, action, entity, entityId, details) {
  const tz = getSettings().timezone;
  run('INSERT INTO audit_log(at, user_id, branch_id, action, entity, entity_id, details, ip) VALUES(?,?,?,?,?,?,?,?)',
    nowLocal(tz), req?.user?.id ?? null, req?.user?.branch_id ?? null, action, entity ?? null, entityId ?? null,
    details == null ? null : typeof details === 'string' ? details : JSON.stringify(details), req ? clientIp(req) : null);
}

module.exports = {
  ROLES, USER_SQL, hashPassword, verifyPassword, checkPasswordStrength, createSession, destroySession,
  attachUser, requireAuth, requireRole, csrfGuard, scopedBranch, throttleLogin, clearThrottle, clientIp, audit,
};
