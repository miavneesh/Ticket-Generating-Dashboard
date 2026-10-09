// Reference data, lookups, notifications and saved views for the signed-in user.
const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db');
const { parseJson, nowIso, HttpError } = require('../lib/util');
const { STATUSES, PRIORITIES, TRANSITIONS, FIELD_DEFS, ROLE_LABELS, OPEN_STATUSES } = require('../lib/constants');
const P = require('../lib/permissions');
const { getSettings } = require('../lib/settings');

const r = express.Router();
const db = () => getDb();

r.get('/meta', (req, res) => {
  const u = req.user;
  const departments = db().prepare('SELECT id, code, name, is_triage FROM departments WHERE is_active = 1 ORDER BY sort_order, name').all();
  const categories = db().prepare('SELECT * FROM ticket_categories WHERE is_active = 1 ORDER BY sort_order, name').all().map((c) => ({
    id: c.id, name: c.name, department_id: c.department_id, is_software: !!c.is_software, requires_closure_approval: !!c.requires_closure_approval,
    visible_fields: parseJson(c.visible_fields, []), required_fields: parseJson(c.required_fields, []), description: c.description,
    subcategories: db().prepare('SELECT id, name, department_id, default_priority FROM ticket_subcategories WHERE category_id = ? AND is_active = 1 ORDER BY sort_order, name').all(c.id),
  }));
  const stages = db().prepare('SELECT name FROM order_stages WHERE is_active = 1 ORDER BY sort_order').all().map((s) => s.name);
  const dealers = u.role === 'dealer'
    ? db().prepare('SELECT id, code, name FROM dealers WHERE id = ?').all(u.dealer_id)
    : db().prepare('SELECT id, code, name FROM dealers WHERE is_active = 1 ORDER BY name').all();
  // Staff directory (for assignment) only for Ozone staff
  const staff = P.isStaff(u)
    ? db().prepare(`SELECT u.id, u.name, u.department_id, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = 1 AND r.code IN ('agent','manager') ORDER BY u.name`).all()
    : [];
  const s = getSettings();
  res.json({
    statuses: STATUSES, openStatuses: OPEN_STATUSES, priorities: PRIORITIES, transitions: TRANSITIONS, fields: FIELD_DEFS, roleLabels: ROLE_LABELS,
    departments, categories, stages, dealers, staff,
    settings: { timezone: s.timezone, company_name: s.company_name, max_upload_mb: Number(s.max_upload_mb), reopen_window_days: Number(s.reopen_window_days) },
  });
});

r.get('/lookup/customers', (req, res) => {
  const q = `%${String(req.query.q || '').toLowerCase()}%`;
  const u = req.user;
  if (!(P.isStaff(u) || u.role === 'dealer' || u.role === 'creator')) throw new HttpError(403, 'Forbidden');
  const rows = u.role === 'dealer'
    ? db().prepare('SELECT id, name, location, dealer_id FROM customers WHERE dealer_id = ? AND lower(name) LIKE ? ORDER BY name LIMIT 15').all(u.dealer_id, q)
    : db().prepare('SELECT id, name, location, dealer_id FROM customers WHERE lower(name) LIKE ? ORDER BY name LIMIT 15').all(q);
  res.json(rows);
});

// OzoneBlu references (manually imported). Dealers only see references for their own dealer code.
r.get('/ozoneblu/lookup', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;
  let sql = `SELECT quote_no, sales_order_no, customer_name, dealer_code, project_location, order_stage, updated_at FROM ozoneblu_references
             WHERE (lower(COALESCE(quote_no,'')) LIKE ? OR lower(COALESCE(sales_order_no,'')) LIKE ? OR lower(COALESCE(customer_name,'')) LIKE ?)`;
  const params = [like, like, like];
  if (req.user.role === 'dealer') {
    const code = db().prepare('SELECT code FROM dealers WHERE id = ?').get(req.user.dealer_id)?.code;
    sql += ' AND dealer_code = ?';
    params.push(code ?? '__none__');
  }
  const rows = db().prepare(`${sql} ORDER BY updated_at DESC LIMIT 10`).all(...params);
  const dealerByCode = db().prepare('SELECT id, name FROM dealers WHERE code = ?');
  res.json(rows.map((r) => ({ ...r, dealer: r.dealer_code ? dealerByCode.get(r.dealer_code) || null : null })));
});

// Routing preview for the create form (same engine the server uses on submit)
r.get('/route-preview', (req, res) => {
  const { route } = require('../lib/routing');
  const category_id = Number(req.query.category_id);
  if (!category_id) return res.json(null);
  const out = route({ category_id, subcategory_id: Number(req.query.subcategory_id) || null, order_stage: req.query.order_stage || null, priority: req.query.priority || null });
  const d = db().prepare('SELECT id, name, is_triage FROM departments WHERE id = ?').get(out.department_id);
  res.json({ department_id: d.id, department_name: d.name, is_triage: !!d.is_triage, routed_by: out.routed_by });
});

// ---------- notifications ----------
r.get('/notifications', (req, res) => {
  const rows = db().prepare(`SELECT n.id, n.type, n.title, n.body, n.is_read, n.created_at, t.ticket_no FROM notifications n
    LEFT JOIN tickets t ON t.id = n.ticket_id WHERE n.user_id = ? AND n.channel = 'in_app' ORDER BY n.created_at DESC, n.id DESC LIMIT 40`).all(req.user.id);
  const unread = db().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND channel = 'in_app' AND is_read = 0`).get(req.user.id).n;
  res.json({ unread, rows });
});
r.post('/notifications/read-all', (req, res) => {
  db().prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});
r.post('/notifications/:id/read', (req, res) => {
  db().prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------- saved views ----------
r.get('/views', (req, res) => {
  res.json(db().prepare('SELECT id, name, filters FROM saved_views WHERE user_id = ? ORDER BY name').all(req.user.id).map((v) => ({ ...v, filters: parseJson(v.filters, {}) })));
});
r.post('/views', (req, res) => {
  const { name, filters } = z.object({ name: z.string().trim().min(1).max(60), filters: z.record(z.string(), z.any()) }).parse(req.body);
  const id = db().prepare('INSERT INTO saved_views (user_id, name, filters, created_at) VALUES (?,?,?,?)').run(req.user.id, name, JSON.stringify(filters), nowIso()).lastInsertRowid;
  res.status(201).json({ id: Number(id), name, filters });
});
r.delete('/views/:id', (req, res) => {
  db().prepare('DELETE FROM saved_views WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

module.exports = r;
