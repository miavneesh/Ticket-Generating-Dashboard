const { getDb } = require('../db');
const { nowIso } = require('./util');

function audit(userId, action, entity, entityId, details, ip) {
  getDb().prepare(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(userId ?? null, action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, ip ?? null, nowIso());
}

module.exports = { audit };
