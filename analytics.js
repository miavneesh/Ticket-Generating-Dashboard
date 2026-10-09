// Dashboard and management reports — computed live from stored ticket data, scoped by the viewer's permissions.
const express = require('express');
const ExcelJS = require('exceljs');
const { getDb } = require('../db');
const { HttpError } = require('../lib/util');
const { buildWhere, BASE_FROM, OPEN_IN, OVERDUE } = require('../lib/ticketQuery');
const { requireRole } = require('../lib/auth');
const { getSettings } = require('../lib/settings');

const r = express.Router();
const db = () => getDb();

function base(user, q) {
  const { where, params } = buildWhere(user, q);
  const cte = `WITH f AS (
    SELECT t.*, c.name AS category_name, c.is_software, s.name AS subcategory_name, d.name AS department_name,
      au.name AS assigned_name, dl.name AS dealer_name,
      CASE WHEN t.status IN ${OPEN_IN} THEN 1 ELSE 0 END AS is_open,
      CASE WHEN ${OVERDUE} THEN 1 ELSE 0 END AS is_overdue
    ${BASE_FROM} WHERE ${where})`;
  return { cte, params };
}
const HRS = (a, b) => `ROUND(AVG((julianday(${b}) - julianday(${a})) * 24), 1)`;

r.get('/dashboard', (req, res) => {
  const { cte, params } = base(req.user, req.query);
  const q = (sql) => db().prepare(`${cte} ${sql}`).all(params);
  const one = (sql) => db().prepare(`${cte} ${sql}`).get(params);
  const off = Number(getSettings().tz_offset_minutes);
  const local = (col) => `date(datetime(${col}, '${off >= 0 ? '+' : ''}${off} minutes'))`;
  const nowLocal = new Date(Date.now() + off * 60000);
  params.monthStart = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), 1) - off * 60000).toISOString();

  const summary = one(`SELECT
      COUNT(*) AS total,
      SUM(status IN ('New','Submitted')) AS new,
      SUM(is_open) AS open,
      SUM(is_open AND assigned_user_id IS NULL) AS unassigned,
      SUM(status = 'In Progress') AS in_progress,
      SUM(status = 'Awaiting Information') AS awaiting_info,
      SUM(status = 'Escalated') AS escalated,
      SUM(is_overdue) AS overdue,
      SUM(resolved_at IS NOT NULL AND resolved_at >= @monthStart) AS resolved_this_month,
      SUM(status = 'Closed') AS closed
    FROM f`);
  for (const k of Object.keys(summary)) summary[k] = summary[k] || 0;

  const byDepartment = q(`SELECT department_id AS id, department_name AS label, COUNT(*) AS total, SUM(is_open) AS open, SUM(is_overdue) AS overdue FROM f GROUP BY department_id ORDER BY total DESC`);
  const byCategory = q(`SELECT category_id AS id, category_name AS label, COUNT(*) AS total, SUM(is_open) AS open FROM f GROUP BY category_id ORDER BY total DESC`);
  const byPriority = q(`SELECT priority AS label, COUNT(*) AS total, SUM(is_open) AS open FROM f GROUP BY priority ORDER BY CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END`);
  const byStatus = q(`SELECT status AS label, COUNT(*) AS total FROM f GROUP BY status`);

  // Trend: daily for ranges up to ~2 months, otherwise monthly. Default last 30 days.
  const to = req.query.to ? new Date(req.query.to) : nowLocal;
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 29 * 86400000);
  const spanDays = Math.round((to - from) / 86400000) + 1;
  const monthly = spanDays > 62;
  const bucket = (col) => (monthly ? `substr(${local(col)}, 1, 7)` : local(col));
  params.tFrom = from.toISOString().slice(0, 10);
  params.tTo = to.toISOString().slice(0, 10);
  const created = q(`SELECT ${bucket('created_at')} AS b, COUNT(*) AS n FROM f WHERE ${local('created_at')} BETWEEN @tFrom AND @tTo GROUP BY b`);
  const resolved = q(`SELECT ${bucket('resolved_at')} AS b, COUNT(*) AS n FROM f WHERE resolved_at IS NOT NULL AND ${local('resolved_at')} BETWEEN @tFrom AND @tTo GROUP BY b`);
  const labels = [];
  if (monthly) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    while (d <= to) { labels.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  } else {
    for (let i = 0; i < spanDays; i++) labels.push(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + i)).toISOString().slice(0, 10));
  }
  const cm = Object.fromEntries(created.map((x) => [x.b, x.n]));
  const rm = Object.fromEntries(resolved.map((x) => [x.b, x.n]));
  const trend = { granularity: monthly ? 'month' : 'day', labels, created: labels.map((l) => cm[l] || 0), resolved: labels.map((l) => rm[l] || 0) };

  const resolutionByDept = q(`SELECT department_name AS label, department_id AS id, ${HRS('created_at', 'resolved_at')} AS hours, COUNT(*) AS n FROM f WHERE resolved_at IS NOT NULL GROUP BY department_id ORDER BY hours DESC`);
  const sla = one(`SELECT
      SUM(resolved_at IS NOT NULL AND sla_resolution_due IS NOT NULL) AS resolved_with_sla,
      SUM(resolved_at IS NOT NULL AND resolved_at <= sla_resolution_due) AS resolved_on_time,
      SUM(first_response_at IS NOT NULL AND sla_first_response_due IS NOT NULL) AS responded,
      SUM(first_response_at IS NOT NULL AND first_response_at <= sla_first_response_due) AS responded_on_time,
      SUM(is_open) AS open, SUM(is_overdue) AS open_overdue
    FROM f`);
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const slaOut = {
    resolution_compliance: pct(sla.resolved_on_time || 0, sla.resolved_with_sla || 0),
    first_response_compliance: pct(sla.responded_on_time || 0, sla.responded || 0),
    resolved_with_sla: sla.resolved_with_sla || 0, resolved_on_time: sla.resolved_on_time || 0,
    open_overdue: sla.open_overdue || 0, open: sla.open || 0,
  };
  const ageing = q(`SELECT
      CASE WHEN age < 1 THEN '< 1 day' WHEN age < 3 THEN '1–3 days' WHEN age < 7 THEN '3–7 days' WHEN age < 15 THEN '7–15 days' WHEN age < 30 THEN '15–30 days' ELSE '30+ days' END AS label,
      CASE WHEN age < 1 THEN 1 WHEN age < 3 THEN 2 WHEN age < 7 THEN 3 WHEN age < 15 THEN 4 WHEN age < 30 THEN 5 ELSE 6 END AS ord,
      COUNT(*) AS total
    FROM (SELECT julianday(@now) - julianday(created_at) AS age FROM f WHERE is_open = 1) GROUP BY label ORDER BY ord`);
  const recurring = q(`SELECT category_name || ' › ' || COALESCE(subcategory_name, 'General') AS label, category_id, subcategory_id, COUNT(*) AS total, SUM(is_open) AS open
    FROM f GROUP BY category_id, subcategory_id HAVING COUNT(*) >= 2 ORDER BY total DESC LIMIT 8`);

  res.json({ summary, byDepartment, byCategory, byPriority, byStatus, trend, resolutionByDept, sla: slaOut, ageing, recurring, monthStart: params.monthStart });
});

// ---------- reports ----------
const REPORTS = {
  department_performance: {
    title: 'Department-wise ticket performance',
    sql: `SELECT department_name AS "Department", COUNT(*) AS "Total", SUM(is_open) AS "Open", SUM(is_overdue) AS "Overdue",
      SUM(resolved_at IS NOT NULL) AS "Resolved", ${HRS('created_at', 'first_response_at')} AS "Avg first response (hrs)",
      ${HRS('created_at', 'resolved_at')} AS "Avg resolution (hrs)",
      ROUND(100.0 * SUM(resolved_at IS NOT NULL AND resolved_at <= sla_resolution_due) / NULLIF(SUM(resolved_at IS NOT NULL AND sla_resolution_due IS NOT NULL), 0), 1) AS "SLA compliance %",
      ROUND(100.0 * SUM(reopen_count > 0) / NULLIF(SUM(resolved_at IS NOT NULL OR reopen_count > 0), 0), 1) AS "Reopened %",
      SUM(transfer_count > 0) AS "Transferred"
      FROM f GROUP BY department_id ORDER BY "Total" DESC`,
  },
  employee_workload: {
    title: 'Employee-wise workload',
    sql: `SELECT COALESCE(assigned_name, '— Unassigned —') AS "Employee", department_name AS "Department", SUM(is_open) AS "Open",
      SUM(status = 'In Progress') AS "In progress", SUM(is_overdue) AS "Overdue", SUM(status = 'Escalated') AS "Escalated",
      SUM(resolved_at IS NOT NULL) AS "Resolved", ${HRS('created_at', 'resolved_at')} AS "Avg resolution (hrs)"
      FROM f GROUP BY assigned_user_id, department_id ORDER BY "Open" DESC`,
  },
  open_overdue: {
    title: 'Open and overdue tickets',
    sql: `SELECT ticket_no AS "Ticket", subject AS "Subject", department_name AS "Department", COALESCE(assigned_name, '—') AS "Assigned to", priority AS "Priority",
      status AS "Status", ROUND(julianday(@now) - julianday(created_at), 1) AS "Age (days)",
      CASE WHEN is_overdue THEN ROUND((julianday(@now) - julianday(sla_resolution_due)) * 24, 1) ELSE 0 END AS "Hours overdue"
      FROM f WHERE is_open = 1 ORDER BY is_overdue DESC, "Hours overdue" DESC, created_at`,
  },
  category: {
    title: 'Tickets by issue category',
    sql: `SELECT category_name AS "Category", COALESCE(subcategory_name, '—') AS "Subcategory", CASE WHEN is_software THEN 'Software' ELSE 'Operational' END AS "Type",
      COUNT(*) AS "Total", SUM(is_open) AS "Open", ${HRS('created_at', 'resolved_at')} AS "Avg resolution (hrs)"
      FROM f GROUP BY category_id, subcategory_id ORDER BY "Total" DESC`,
  },
  sla_compliance: {
    title: 'SLA compliance & first-response time by priority',
    sql: `SELECT priority AS "Priority", COUNT(*) AS "Tickets", ${HRS('created_at', 'first_response_at')} AS "Avg first response (hrs)",
      ROUND(100.0 * SUM(first_response_at <= sla_first_response_due) / NULLIF(SUM(first_response_at IS NOT NULL AND sla_first_response_due IS NOT NULL), 0), 1) AS "First response met %",
      ${HRS('created_at', 'resolved_at')} AS "Avg resolution (hrs)",
      ROUND(100.0 * SUM(resolved_at <= sla_resolution_due) / NULLIF(SUM(resolved_at IS NOT NULL AND sla_resolution_due IS NOT NULL), 0), 1) AS "Resolution met %",
      SUM(is_overdue) AS "Open overdue"
      FROM f GROUP BY priority ORDER BY CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END`,
  },
  reopened: {
    title: 'Reopened tickets',
    sql: `SELECT department_name AS "Department", SUM(resolved_at IS NOT NULL OR reopen_count > 0) AS "Resolved at least once", SUM(reopen_count > 0) AS "Reopened",
      ROUND(100.0 * SUM(reopen_count > 0) / NULLIF(SUM(resolved_at IS NOT NULL OR reopen_count > 0), 0), 1) AS "Reopened %", SUM(reopen_count) AS "Total reopen events"
      FROM f GROUP BY department_id ORDER BY "Reopened" DESC`,
  },
  repeat_issues: {
    title: 'Repeat issues by category',
    sql: `SELECT category_name AS "Category", COALESCE(subcategory_name, '—') AS "Subcategory", COUNT(*) AS "Occurrences",
      COUNT(DISTINCT COALESCE(sales_order_no, quote_no, ticket_no)) AS "Distinct orders/quotes", COUNT(DISTINCT dealer_id) AS "Dealers affected",
      MAX(created_at) AS "Last reported"
      FROM f GROUP BY category_id, subcategory_id HAVING COUNT(*) >= 2 ORDER BY "Occurrences" DESC`,
  },
  root_cause: {
    title: 'Root-cause analysis',
    sql: `SELECT category_name AS "Category", COALESCE(subcategory_name, '—') AS "Subcategory", root_cause AS "Root cause", COUNT(*) AS "Tickets",
      GROUP_CONCAT(ticket_no, ', ') AS "Ticket IDs"
      FROM f WHERE root_cause IS NOT NULL GROUP BY category_id, lower(trim(root_cause)) ORDER BY "Tickets" DESC`,
  },
  transfers: {
    title: 'Tickets transferred between departments',
    sql: `SELECT fd.name AS "From department", td.name AS "To department", COUNT(*) AS "Transfers", GROUP_CONCAT(DISTINCT f.ticket_no) AS "Tickets"
      FROM ticket_transfers tr JOIN f ON f.id = tr.ticket_id LEFT JOIN departments fd ON fd.id = tr.from_department_id JOIN departments td ON td.id = tr.to_department_id
      GROUP BY tr.from_department_id, tr.to_department_id ORDER BY "Transfers" DESC`,
  },
  dealer_volume: {
    title: 'Dealer-wise issue volume',
    sql: `SELECT COALESCE(dealer_name, 'Direct / no dealer') AS "Dealer", COUNT(*) AS "Total", SUM(is_open) AS "Open", SUM(is_overdue) AS "Overdue",
      ${HRS('created_at', 'resolved_at')} AS "Avg resolution (hrs)", SUM(category_name = 'Service') AS "Service complaints"
      FROM f GROUP BY dealer_id ORDER BY "Total" DESC`,
  },
  customer_issues: {
    title: 'Customer / project-related issues',
    sql: `SELECT COALESCE(customer_name, '—') AS "Customer", COALESCE(project_location, '—') AS "Location", COALESCE(dealer_name, '—') AS "Dealer",
      COUNT(*) AS "Tickets", SUM(is_open) AS "Open", GROUP_CONCAT(DISTINCT category_name) AS "Categories", MAX(created_at) AS "Last ticket"
      FROM f WHERE customer_name IS NOT NULL GROUP BY lower(customer_name) ORDER BY "Tickets" DESC`,
  },
  monthly_trend: {
    title: 'Monthly trend',
    sql: `SELECT substr(created_at, 1, 7) AS "Month", COUNT(*) AS "Created", SUM(resolved_at IS NOT NULL) AS "Resolved (of created)",
      SUM(status = 'Closed') AS "Closed", SUM(is_software) AS "Software issues", SUM(1 - is_software) AS "Operational issues",
      ${HRS('created_at', 'resolved_at')} AS "Avg resolution (hrs)"
      FROM f GROUP BY substr(created_at, 1, 7) ORDER BY "Month"`,
  },
  quarterly_trend: {
    title: 'Quarterly trend (Indian FY)',
    sql: `SELECT CASE WHEN CAST(substr(created_at,6,2) AS INT) >= 4 THEN 'FY' || substr(CAST(substr(created_at,1,4) AS INT) + 1, 3, 2) ELSE 'FY' || substr(created_at, 3, 2) END
        || ' Q' || ((CAST(substr(created_at,6,2) AS INT) + 8) % 12 / 3 + 1) AS "Quarter",
      COUNT(*) AS "Created", SUM(resolved_at IS NOT NULL) AS "Resolved", SUM(is_software) AS "Software", SUM(1 - is_software) AS "Operational",
      ${HRS('created_at', 'resolved_at')} AS "Avg resolution (hrs)"
      FROM f GROUP BY "Quarter" ORDER BY MIN(created_at)`,
  },
};

r.get('/reports', requireRole('manager', 'admin'), (_req, res) => {
  res.json(Object.entries(REPORTS).map(([key, v]) => ({ key, title: v.title })));
});

r.get('/reports/:type', requireRole('manager', 'admin'), async (req, res) => {
  const rep = REPORTS[req.params.type];
  if (!rep) throw new HttpError(404, 'Unknown report');
  const { cte, params } = base(req.user, req.query);
  const stmt = db().prepare(`${cte} ${rep.sql}`);
  const rows = stmt.all(params);
  const columns = stmt.columns().map((c) => c.name);
  const stamp = new Date().toISOString().slice(0, 10);
  if (req.query.format === 'csv') {
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${stamp}.csv"`);
    return res.send('﻿' + [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n'));
  }
  if (req.query.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(rep.title.slice(0, 30).replace(/[\\/*?:[\]]/g, ''));
    ws.addRow([rep.title]).font = { bold: true, size: 14 };
    ws.addRow([`Generated ${new Date().toLocaleString('en-IN', { timeZone: getSettings().timezone })}`]);
    ws.addRow([]);
    const h = ws.addRow(columns);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D6E' } }; });
    rows.forEach((r) => ws.addRow(columns.map((c) => r[c])));
    ws.columns.forEach((c) => { c.width = 22; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${stamp}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  res.json({ title: rep.title, columns, rows });
});

module.exports = r;
