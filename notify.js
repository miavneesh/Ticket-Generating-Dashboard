// In-app notifications (+ queued email records). Internal content is never sent to dealers or requesters.
const { getDb } = require('../db');
const { nowIso } = require('./util');

function channelsFor(type) {
  const s = getDb().prepare('SELECT in_app, email FROM notification_settings WHERE event_type = ?').get(type);
  return s || { in_app: 1, email: 0 };
}

/** recipients: array of user ids (duplicates/nulls removed, actor excluded). */
function notify(recipients, { type, ticket, title, body, actorId, staffOnly = false }) {
  const db = getDb();
  const ids = [...new Set(recipients.filter((x) => x && x !== actorId))];
  if (!ids.length) return 0;
  const ch = channelsFor(type);
  const users = db.prepare(`SELECT u.id, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 AND u.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const ins = db.prepare('INSERT INTO notifications (user_id, ticket_id, type, title, body, channel, delivered_at, created_at) VALUES (?,?,?,?,?,?,?,?)');
  const now = nowIso();
  let n = 0;
  for (const u of users) {
    if (staffOnly && !['agent', 'manager', 'admin'].includes(u.role)) continue;
    if (ch.in_app) { ins.run(u.id, ticket?.id ?? null, type, title, body ?? null, 'in_app', now, now); n++; }
    if (ch.email) { ins.run(u.id, ticket?.id ?? null, type, title, body ?? null, 'email', null, now); } // picked up by mail worker (Phase 2)
  }
  return n;
}

function deptManagers(deptId) {
  return getDb().prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 AND r.code = 'manager' AND u.department_id = ?`).all(deptId).map((r) => r.id);
}
function deptStaff(deptId) {
  return getDb().prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 AND r.code IN ('agent','manager') AND u.department_id = ?`).all(deptId).map((r) => r.id);
}

module.exports = { notify, deptManagers, deptStaff };
