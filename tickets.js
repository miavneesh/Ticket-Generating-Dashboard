const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const config = require('../config');
const { getDb } = require('../db');
const { HttpError, parseJson, nowIso } = require('../lib/util');
const svc = require('../lib/ticketService');
const P = require('../lib/permissions');
const { upload, saveAttachments, discard } = require('../lib/attachments');
const { buildWhere, BASE_FROM, SORTS, SELECT_COLS } = require('../lib/ticketQuery');
const { getSettings } = require('../lib/settings');

const r = express.Router();
const db = () => getDb();

// Run a mutation atomically; on failure remove any uploaded files
function tx(files, fn) {
  try {
    return db().transaction(fn)();
  } catch (e) {
    discard(files);
    throw e;
  }
}

function payload(req) {
  // Multipart requests send JSON in a "data" field; JSON requests use the body directly
  if (req.is('multipart/form-data')) return parseJson(req.body?.data, {});
  return req.body || {};
}

// ---------- list / search ----------
function queryTickets(user, q, { limit, offset }) {
  const { where, params } = buildWhere(user, q);
  const sortKey = SORTS[q.sort] ? q.sort : 'updated_at';
  let dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  if (sortKey === 'age') dir = dir === 'ASC' ? 'DESC' : 'ASC'; // larger age = older created_at
  const total = db().prepare(`SELECT COUNT(*) AS n ${BASE_FROM} WHERE ${where}`).get(params).n;
  const rows = db().prepare(`SELECT ${SELECT_COLS} ${BASE_FROM} WHERE ${where} ORDER BY ${SORTS[sortKey]} ${dir}, t.id DESC LIMIT ${limit} OFFSET ${offset}`).all(params);
  return { total, rows };
}

r.get('/', (req, res) => {
  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const { total, rows } = queryTickets(req.user, req.query, { limit: pageSize, offset: (page - 1) * pageSize });
  res.json({ total, page, pageSize, rows });
});

r.get('/export', async (req, res) => {
  const { rows } = queryTickets(req.user, req.query, { limit: 10000, offset: 0 });
  const tz = getSettings().timezone;
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : '');
  const ageDays = (t) => Math.floor(((t.closed_at ? new Date(t.closed_at) : new Date()) - new Date(t.created_at)) / 86400000);
  const cols = [
    ['Ticket ID', (t) => t.ticket_no], ['Subject', (t) => t.subject], ['Category', (t) => t.category_name], ['Subcategory', (t) => t.subcategory_name || ''],
    ['Issue Type', (t) => (t.is_software ? 'Software' : 'Operational')], ['Quote No', (t) => t.quote_no || ''], ['Sales Order No', (t) => t.sales_order_no || ''],
    ['Requester', (t) => t.requester_name], ['Dealer', (t) => t.dealer_name || ''], ['Customer', (t) => t.customer_name || ''],
    ['Department', (t) => t.department_name], ['Assigned To', (t) => t.assigned_name || ''], ['Priority', (t) => t.priority], ['Status', (t) => t.status],
    ['Created', (t) => fmt(t.created_at)], ['Last Updated', (t) => fmt(t.updated_at)], ['Age (days)', ageDays], ['SLA Due', (t) => fmt(t.sla_resolution_due)],
    ['Overdue', (t) => (t.is_overdue ? 'Yes' : 'No')],
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  if (req.query.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tickets');
    ws.addRow(cols.map((c) => c[0]));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D6E' } };
    rows.forEach((t) => ws.addRow(cols.map((c) => c[1](t))));
    ws.columns.forEach((c, i) => { c.width = i === 1 ? 50 : 18; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ozone-tickets-${stamp}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.map((c) => c[0]).join(','), ...rows.map((t) => cols.map((c) => esc(c[1](t))).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ozone-tickets-${stamp}.csv"`);
  res.send('﻿' + csv);
});

// ---------- create ----------
r.post('/', upload.array('files', 10), (req, res) => {
  const t = tx(req.files, () => {
    const ticket = svc.createTicket(req.user, payload(req));
    saveAttachments(req.user, ticket, req.files, { at: ticket.created_at });
    return ticket;
  });
  res.status(201).json({ id: t.id, ticket_no: t.ticket_no, status: t.status, department_id: t.department_id });
});

// ---------- detail ----------
r.get('/:id', (req, res) => {
  const t = svc.loadVisible(req.user, req.params.id);
  res.json(svc.getDetail(req.user, t));
});

r.patch('/:id', (req, res) => {
  const t = svc.loadVisible(req.user, req.params.id);
  tx([], () => svc.editTicket(req.user, t, req.body || {}));
  res.json(svc.getDetail(req.user, t));
});

r.post('/:id/status', (req, res) => {
  const t = svc.loadVisible(req.user, req.params.id);
  tx([], () => svc.changeStatus(req.user, t, req.body || {}));
  res.json(svc.getDetail(req.user, t));
});

r.post('/:id/assign', (req, res) => {
  const t = svc.loadVisible(req.user, req.params.id);
  tx([], () => svc.assign(req.user, t, req.body || {}));
  res.json(svc.getDetail(req.user, t));
});

r.post('/:id/transfer', (req, res) => {
  const t = svc.loadVisible(req.user, req.params.id);
  tx([], () => svc.transfer(req.user, t, req.body || {}));
  // After transfer the user may no longer be able to work it, but can still view history
  res.json(svc.getDetail(req.user, t));
});

r.post('/:id/comments', upload.array('files', 10), (req, res) => {
  let t;
  try { t = svc.loadVisible(req.user, req.params.id); } catch (e) { discard(req.files); throw e; }
  const body = payload(req);
  tx(req.files, () => {
    const internal = body.is_internal === true || body.is_internal === 'true';
    const commentId = svc.addComment(req.user, t, body);
    saveAttachments(req.user, t, req.files, { internal, commentId });
  });
  res.status(201).json(svc.getDetail(req.user, svc.loadTicket(t.id)));
});

r.post('/:id/attachments', upload.array('files', 10), (req, res) => {
  let t;
  try { t = svc.loadVisible(req.user, req.params.id); } catch (e) { discard(req.files); throw e; }
  if (!req.files?.length) throw new HttpError(400, 'No files uploaded');
  const internal = req.body?.is_internal === 'true';
  tx(req.files, () => {
    saveAttachments(req.user, t, req.files, { internal });
    db().prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(nowIso(), t.id);
  });
  res.status(201).json(svc.getDetail(req.user, svc.loadTicket(t.id)));
});

module.exports = r;

// ---------- attachment download (separate router, mounted at /api/attachments) ----------
const files = express.Router();
files.get('/:id', (req, res) => {
  const a = db().prepare('SELECT * FROM ticket_attachments WHERE id = ?').get(Number(req.params.id));
  if (!a) throw new HttpError(404, 'File not found');
  const t = svc.loadTicket(a.ticket_id);
  if (!P.canView(req.user, t) || (a.is_internal && !P.canSeeInternal(req.user, t))) throw new HttpError(404, 'File not found');
  const full = path.join(config.uploadDir, path.basename(a.stored_name));
  if (!fs.existsSync(full)) throw new HttpError(404, 'File missing from storage');
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(a.mime_type) && req.query.download !== '1';
  res.setHeader('Content-Type', a.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
  fs.createReadStream(full).pipe(res);
});
module.exports.files = files;
