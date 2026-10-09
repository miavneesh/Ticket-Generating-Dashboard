const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db');
const { HttpError } = require('./util');

const COOKIE = 'oz_token';

function loadUser(id) {
  return getDb().prepare(`
    SELECT u.id, u.name, u.email, u.department_id, u.dealer_id, u.designation, u.is_active, r.code AS role, r.name AS role_name,
      d.name AS department_name, d.sees_all AS dept_sees_all, d.is_triage AS dept_is_triage, dl.name AS dealer_name
    FROM users u JOIN roles r ON r.id = u.role_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN dealers dl ON dl.id = u.dealer_id
    WHERE u.id = ?`).get(id);
}

function issueToken(res, user) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: `${config.jwtTtlHours}h` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: config.jwtTtlHours * 3600 * 1000, path: '/' });
  return token;
}

function requireAuth(req, _res, next) {
  const header = req.headers.authorization;
  const token = req.cookies?.[COOKIE] || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return next(new HttpError(401, 'Please sign in'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = loadUser(payload.sub);
    if (!user || !user.is_active) return next(new HttpError(401, 'Account is disabled or no longer exists'));
    req.user = user;
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please sign in again'));
  }
}

const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have permission for this action')));

/** CSRF defence for cookie auth: mutating requests must carry a custom header (browsers block it cross-site without CORS). */
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'OzoneTracker') return next(new HttpError(403, 'Missing request header'));
  next();
}

module.exports = { requireAuth, requireRole, issueToken, loadUser, csrfGuard, COOKIE };
