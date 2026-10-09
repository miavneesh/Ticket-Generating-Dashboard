const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { getDb } = require('../db');
const { requireAuth, issueToken, loadUser, COOKIE } = require('../lib/auth');
const { HttpError, nowIso } = require('../lib/util');
const { audit } = require('../lib/audit');

const r = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 1000 : 20, standardHeaders: true, legacyHeaders: false });

r.post('/login', limiter, (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().email(), password: z.string().min(1) }).parse(req.body);
  const row = getDb().prepare('SELECT id, password_hash, is_active FROM users WHERE email = ?').get(email);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    audit(row?.id, 'auth.login_failed', 'user', email, null, req.ip);
    throw new HttpError(401, 'Invalid email or password');
  }
  if (!row.is_active) throw new HttpError(403, 'Your account is disabled. Contact the administrator.');
  getDb().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
  issueToken(res, row);
  audit(row.id, 'auth.login', 'user', row.id, null, req.ip);
  res.json({ user: loadUser(row.id) });
});

r.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

r.post('/change-password', requireAuth, (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8, 'Use at least 8 characters') }).parse(req.body);
  const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, row.password_hash)) throw new HttpError(400, 'Current password is incorrect', { current: 'Incorrect password' });
  getDb().prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), nowIso(), req.user.id);
  audit(req.user.id, 'auth.password_change', 'user', req.user.id, null, req.ip);
  res.json({ ok: true });
});

module.exports = r;
