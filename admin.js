// System administration: users, departments, categories, routing, SLA, settings, audit, OzoneBlu import.
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { getDb } = require('../db');
const { HttpError, nowIso, parseJson } = require('../lib/util');
const { audit } = require('../lib/audit');
const { FIELD_KEYS, PRIORITIES } = require('../lib/constants');
const { DEFAULTS } = require('../lib/settings');

const r = express.Router();
const db = () => getDb();

// field types: s = string, i = integer id/number, b = boolean, j = JSON array of field keys, p = priority
const TABLES = {
  departments: { fields: { code: 's', name: 's', is_triage: 'b', sees_all: 'b', head_user_id: 'i', email: 's', is_active: 'b', sort_order: 'i' }, required: ['code', 'name'], order: 'sort_order, name' },
  dealers: { fields: { code: 's', name: 's', city: 's', contact_person: 's', phone: 's', email: 's', is_active: 'b' }, required: ['code', 'name'], order: 'name' },
  customers: { fields: { name: 's', phone: 's', email: 's', location: 's', dealer_id: 'i', is_confidential: 'b' }, required: ['name'], order: 'name' },
  categories: { table: 'ticket_categories', fields: { name: 's', department_id: 'i', is_software: 'b', requires_closure_approval: 'b', visible_fields: 'j', required_fields: 'j', description: 's', is_active: 'b', sort_order: 'i' }, required: ['name'], order: 'sort_order, name' },
  subcategories: { table: 'ticket_subcategories', fields: { category_id: 'i', name: 's', department_id: 'i', default_priority: 'p', is_active: 'b', sort_order: 'i' }, required: ['category_id', 'name'], order: 'category_id, sort_order, name' },
  routing_rules: { fields: { name: 's', category_id: 'i', subcategory_id: 'i', order_stage: 's', priority: 'p', department_id: 'i', assign_user_id: 'i', rank: 'i', is_active: 'b' }, required: ['name', 'department_id'], order: 'rank, id', deletable: true },
  sla_policies: { fields: { name: 's', priority: 'p', department_id: 'i', category_id: 'i', first_response_minutes: 'i', resolution_minutes: 'i', pause_on_awaiting_info: 'b', pause_on_hold: 'b', is_active: 'b' }, required: ['name', 'priority', 'first_response_minutes', 'resolution_minutes'], order: "CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, id" },
  escalation_rules: { fields: { name: 's', trigger_type: 's', minutes_after: 'i', priority: 'p', department_id: 'i', notify_role: 's', notify_user_id: 'i', level: 'i', is_active: 'b' }, required: ['name', 'trigger_type'], order: 'level, id', deletable: true },
  order_stages: { fields: { code: 's', name: 's', sort_order: 'i', is_active: 'b' }, required: ['code', 'name'], order: 'sort_order' },
  holidays: { fields: { date: 's', name: 's' }, required: ['date', 'name'], order: 'date', deletable: true },
};

function coerce(spec, body, partial) {
  const out = {};
  for (const [k, type] of Object.entries(spec.fields)) {
    if (!(k in body)) continue;
    let v = body[k];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (type === 'i') { v = Number(v); if (!Number.isFinite(v)) throw new HttpError(400, `${k} must be a number`, { [k]: 'Must be a number' }); }
      if (type === 'b') v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
      if (type === 's') v = String(v).trim().slice(0, 500);
      if (type === 'p' && !PRIORITIES.includes(v)) throw new HttpError(400, `Invalid priority`, { [k]: 'Invalid priority' });
      if (type === 'j') {
        const arr = Array.isArray(v) ? v : parseJson(v, null);
        if (!Array.isArray(arr) || arr.some((x) => !FIELD_KEYS.includes(x))) throw new HttpError(400, `${k} must be a list of known fields`);
        v = JSON.stringify(arr);
      }
    } else if (type === 'j') v = '[]';
    else if (type === 'b') v = 0;
    out[k] = v;
  }
  if (!partial) for (const k of spec.required) if (out[k] == null) throw new HttpError(400, `${k} is required`, { [k]: 'Required' });
  if (partial) for (const k of spec.required) if (k in out && out[k] == null) throw new HttpError(400, `${k} is required`, { [k]: 'Required' });
  return out;
}

function dbWrite(fn) {
  try { return fn(); } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'A record with this value already exists');
    if (/FOREIGN KEY/.test(e.message)) throw new HttpError(400, 'Referenced record does not exist');
    throw e;
  }
}

for (const [key, spec] of Object.entries(TABLES)) {
  const table = spec.table || key;
  r.get(`/${key}`, (_req, res) => res.json(db().prepare(`SELECT * FROM ${table} ORDER BY ${spec.order}`).all()));
  r.post(`/${key}`, (req, res) => {
    const data = coerce(spec, req.body || {}, false);
    const cols = Object.keys(data);
    const id = dbWrite(() => db().prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => data[c])).lastInsertRowid);
    audit(req.user.id, `admin.${key}.create`, key, id, data, req.ip);
    res.status(201).json(db().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  });
  r.patch(`/${key}/:id`, (req, res) => {
    const id = Number(req.params.id);
    const before = db().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!before) throw new HttpError(404, 'Not found');
    const data = coerce(spec, req.body || {}, true);
    const cols = Object.keys(data);
    if (cols.length) dbWrite(() => db().prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), id));
    audit(req.user.id, `admin.${key}.update`, key, id, { before: Object.fromEntries(cols.map((c) => [c, before[c]])), after: data }, req.ip);
    res.json(db().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  });
  if (spec.deletable) {
    r.delete(`/${key}/:id`, (req, res) => {
      dbWrite(() => db().prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id)));
      audit(req.user.id, `admin.${key}.delete`, key, req.params.id, null, req.ip);
      res.json({ ok: true });
    });
  }
}

// ---------- users ----------
const idOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const userSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(8).optional(),
  role: z.enum(['creator', 'dealer', 'agent', 'manager', 'admin']),
  department_id: z.preprocess(idOrNull, z.number().int().positive().nullable()).optional(),
  dealer_id: z.preprocess(idOrNull, z.number().int().positive().nullable()).optional(),
  designation: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(100).nullable()).optional(),
  phone: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(30).nullable()).optional(),
  is_active: z.boolean().optional(),
});

function checkUserShape(d) {
  if (d.role === 'dealer' && !d.dealer_id) throw new HttpError(400, 'Dealer users must be linked to a dealer', { dealer_id: 'Required for dealer users' });
  if (['agent', 'manager'].includes(d.role) && !d.department_id) throw new HttpError(400, 'Support and department head users need a department', { department_id: 'Required' });
  if (d.role !== 'dealer') d.dealer_id = null;
}

const roleId = (code) => db().prepare('SELECT id FROM roles WHERE code = ?').get(code).id;
const USER_COLS = `u.id, u.name, u.email, u.department_id, u.dealer_id, u.designation, u.phone, u.is_active, u.last_login_at, u.created_at, r.code AS role, d.name AS department_name, dl.name AS dealer_name`;
const USER_FROM = `FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN dealers dl ON dl.id = u.dealer_id`;

r.get('/users', (_req, res) => res.json(db().prepare(`SELECT ${USER_COLS} ${USER_FROM} ORDER BY u.name`).all()));
r.post('/users', (req, res) => {
  const d = userSchema.parse(req.body);
  if (!d.password) throw new HttpError(400, 'Initial password is required (min 8 characters)', { password: 'Required' });
  checkUserShape(d);
  const now = nowIso();
  const id = dbWrite(() => db().prepare(`INSERT INTO users (name, email, password_hash, role_id, department_id, dealer_id, designation, phone, is_active, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(d.name, d.email, bcrypt.hashSync(d.password, 10), roleId(d.role), d.department_id ?? null, d.dealer_id ?? null, d.designation ?? null, d.phone ?? null, d.is_active === false ? 0 : 1, now, now).lastInsertRowid);
  audit(req.user.id, 'admin.users.create', 'user', id, { email: d.email, role: d.role }, req.ip);
  res.status(201).json(db().prepare(`SELECT ${USER_COLS} ${USER_FROM} WHERE u.id = ?`).get(id));
});
r.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db().prepare(`SELECT ${USER_COLS} ${USER_FROM} WHERE u.id = ?`).get(id);
  if (!cur) throw new HttpError(404, 'User not found');
  const d = userSchema.partial().parse(req.body);
  const merged = { ...cur, ...d };
  checkUserShape(merged);
  if (id === req.user.id && (d.is_active === false || (d.role && d.role !== 'admin'))) throw new HttpError(400, 'You cannot disable or demote your own account');
  dbWrite(() => db().prepare(`UPDATE users SET name=?, email=?, role_id=?, department_id=?, dealer_id=?, designation=?, phone=?, is_active=?, updated_at=? WHERE id=?`)
    .run(merged.name, merged.email, roleId(merged.role), merged.department_id ?? null, merged.dealer_id ?? null, merged.designation ?? null, merged.phone ?? null, merged.is_active ? 1 : 0, nowIso(), id));
  if (d.password) db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(d.password, 10), id);
  audit(req.user.id, 'admin.users.update', 'user', id, { fields: Object.keys(d).filter((k) => k !== 'password'), password_reset: !!d.password }, req.ip);
  res.json(db().prepare(`SELECT ${USER_COLS} ${USER_FROM} WHERE u.id = ?`).get(id));
});

// ---------- settings ----------
r.get('/settings', (_req, res) => {
  const rows = Object.fromEntries(db().prepare('SELECT key, value FROM settings').all().map((x) => [x.key, x.value]));
  res.json({ ...DEFAULTS, ...rows });
});
r.put('/settings', (req, res) => {
  const body = req.body || {};
  const ins = db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const changed = {};
  for (const k of Object.keys(DEFAULTS)) if (k in body) { ins.run(k, String(body[k])); changed[k] = String(body[k]); }
  audit(req.user.id, 'admin.settings.update', 'settings', null, changed, req.ip);
  res.json({ ok: true });
});
r.get('/notification_settings', (_req, res) => res.json(db().prepare('SELECT * FROM notification_settings ORDER BY event_type').all()));
r.put('/notification_settings/:event', (req, res) => {
  const { in_app, email } = req.body || {};
  db().prepare('INSERT INTO notification_settings (event_type, in_app, email) VALUES (?,?,?) ON CONFLICT(event_type) DO UPDATE SET in_app = excluded.in_app, email = excluded.email')
    .run(req.params.event, in_app ? 1 : 0, email ? 1 : 0);
  audit(req.user.id, 'admin.notifications.update', 'notification_settings', req.params.event, { in_app, email }, req.ip);
  res.json({ ok: true });
});

// ---------- audit log ----------
r.get('/audit', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = []; const params = [];
  if (req.query.entity) { where.push('a.entity = ?'); params.push(req.query.entity); }
  if (req.query.q) { where.push('(a.action LIKE ? OR a.entity_id LIKE ? OR u.name LIKE ?)'); const l = `%${req.query.q}%`; params.push(l, l, l); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db().prepare(`SELECT COUNT(*) AS n FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${w}`).get(...params).n;
  const rows = db().prepare(`SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${w} ORDER BY a.id DESC LIMIT 50 OFFSET ?`).all(...params, (page - 1) * 50);
  res.json({ total, page, rows });
});

// ---------- OzoneBlu reference import (CSV; no scraping or direct OzoneBlu access) ----------
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

r.post('/ozoneblu/import', (req, res) => {
  const csv = String(req.body?.csv || '').replace(/^﻿/, '');
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new HttpError(400, 'CSV must include a header row and at least one data row');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const COLS = ['quote_no', 'sales_order_no', 'customer_name', 'dealer_code', 'project_location', 'order_stage'];
  if (!header.includes('quote_no') && !header.includes('sales_order_no')) throw new HttpError(400, 'CSV needs a quote_no or sales_order_no column');
  const now = nowIso();
  const upsertQ = db().prepare(`INSERT INTO ozoneblu_references (quote_no, sales_order_no, customer_name, dealer_code, project_location, order_stage, imported_by, updated_at)
    VALUES (@quote_no, @sales_order_no, @customer_name, @dealer_code, @project_location, @order_stage, @by, @now)
    ON CONFLICT(quote_no) WHERE quote_no IS NOT NULL DO UPDATE SET sales_order_no = COALESCE(excluded.sales_order_no, sales_order_no), customer_name = COALESCE(excluded.customer_name, customer_name),
      dealer_code = COALESCE(excluded.dealer_code, dealer_code), project_location = COALESCE(excluded.project_location, project_location),
      order_stage = COALESCE(excluded.order_stage, order_stage), imported_by = excluded.imported_by, updated_at = excluded.updated_at`);
  let n = 0; const errors = [];
  db().transaction(() => {
    rows.slice(1).forEach((cells, idx) => {
      const rec = { by: req.user.id, now };
      for (const c of COLS) { const i = header.indexOf(c); rec[c] = i >= 0 && cells[i]?.trim() ? cells[i].trim() : null; }
      if (!rec.quote_no && !rec.sales_order_no) { errors.push(`Row ${idx + 2}: missing quote_no and sales_order_no`); return; }
      upsertQ.run(rec); n++;
    });
  })();
  audit(req.user.id, 'admin.ozoneblu.import', 'ozoneblu_references', null, { imported: n, errors: errors.length }, req.ip);
  res.json({ imported: n, errors });
});
r.get('/ozoneblu/references', (_req, res) => res.json(db().prepare('SELECT * FROM ozoneblu_references ORDER BY updated_at DESC LIMIT 200').all()));

module.exports = r;
