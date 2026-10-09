// Shared filter builder for ticket lists, dashboard and reports — always applies visibility rules.
const { visibilitySql } = require('./permissions');
const { OPEN_STATUSES, STATUSES, PRIORITIES } = require('./constants');
const { HttpError } = require('./util');

const OPEN_IN = `(${OPEN_STATUSES.map((s) => `'${s}'`).join(',')})`;
const OVERDUE = `(t.status IN ${OPEN_IN} AND t.sla_paused_at IS NULL AND t.sla_resolution_due IS NOT NULL AND t.sla_resolution_due < @now)`;

const BASE_FROM = `
  FROM tickets t
  JOIN ticket_categories c ON c.id = t.category_id
  LEFT JOIN ticket_subcategories s ON s.id = t.subcategory_id
  JOIN departments d ON d.id = t.department_id
  LEFT JOIN users au ON au.id = t.assigned_user_id
  JOIN users ru ON ru.id = t.requester_id
  LEFT JOIN dealers dl ON dl.id = t.dealer_id`;

const list = (v) => (v == null || v === '' ? [] : String(v).split(',').map((x) => x.trim()).filter(Boolean));
const ints = (v) => list(v).map(Number).filter(Number.isInteger);

function buildWhere(user, q = {}) {
  const vis = visibilitySql(user);
  const where = [vis.sql];
  const params = { now: new Date().toISOString() };
  const pos = [...vis.params];
  // Convert positional visibility params into named ones
  let i = 0;
  where[0] = where[0].replace(/\?/g, () => { const k = `v${i}`; params[k] = pos[i++]; return `@${k}`; });

  const inList = (col, vals, prefix) => {
    if (!vals.length) return;
    where.push(`${col} IN (${vals.map((v, j) => { params[`${prefix}${j}`] = v; return `@${prefix}${j}`; }).join(',')})`);
  };
  inList('t.status', list(q.status).filter((s) => STATUSES.includes(s)), 'st');
  inList('t.priority', list(q.priority).filter((p) => PRIORITIES.includes(p)), 'pr');
  inList('t.department_id', ints(q.department_id), 'dp');
  inList('t.category_id', ints(q.category_id), 'ct');
  inList('t.subcategory_id', ints(q.subcategory_id), 'sc');
  inList('t.dealer_id', ints(q.dealer_id), 'dl');
  inList('t.order_stage', list(q.order_stage), 'os');
  if (q.assigned_user_id === 'none') where.push('t.assigned_user_id IS NULL');
  else inList('t.assigned_user_id', ints(q.assigned_user_id), 'as');
  inList('t.requester_id', ints(q.requester_id), 'rq');
  if (q.from) { params.from = new Date(q.from).toISOString(); where.push('t.created_at >= @from'); }
  if (q.to) { const d = new Date(q.to); d.setUTCDate(d.getUTCDate() + 1); params.to = d.toISOString(); where.push('t.created_at < @to'); }
  if (q.resolved_from) { params.rfrom = new Date(q.resolved_from).toISOString(); where.push('t.resolved_at >= @rfrom'); }
  if (q.issue_type === 'software') where.push('c.is_software = 1');
  if (q.issue_type === 'operational') where.push('c.is_software = 0');
  if (q.overdue === '1' || q.overdue === 'true') where.push(OVERDUE);
  if (q.open === '1') where.push(`t.status IN ${OPEN_IN}`);
  if (q.q) {
    params.q = `%${String(q.q).trim().toLowerCase()}%`;
    where.push(`(lower(t.ticket_no) LIKE @q OR lower(t.subject) LIKE @q OR lower(COALESCE(t.quote_no,'')) LIKE @q OR lower(COALESCE(t.sales_order_no,'')) LIKE @q
      OR lower(COALESCE(t.customer_name,'')) LIKE @q OR lower(COALESCE(dl.name,'')) LIKE @q OR lower(COALESCE(t.production_order_no,'')) LIKE @q OR lower(COALESCE(t.survey_ref,'')) LIKE @q)`);
  }
  // Quick views
  params.me = user.id;
  switch (q.view) {
    case 'mine': where.push('t.requester_id = @me'); break;
    case 'assigned': where.push(`t.assigned_user_id = @me AND t.status IN ${OPEN_IN}`); break;
    case 'department': params.mydept = user.department_id ?? -1; where.push('t.department_id = @mydept'); break;
    case 'unassigned': where.push(`t.assigned_user_id IS NULL AND t.status IN ${OPEN_IN}`); break;
    case 'awaiting_me': where.push(`((t.requester_id = @me AND t.status = 'Awaiting Information') OR (t.assigned_user_id = @me AND t.status IN ('Assigned','Escalated')))`); break;
    case 'overdue': where.push(OVERDUE); break;
    case 'escalated': where.push(`t.status = 'Escalated'`); break;
    case 'recently_resolved': params.recent = new Date(Date.now() - 14 * 86400000).toISOString(); where.push(`t.status IN ('Resolved','Closed') AND t.resolved_at >= @recent`); break;
    case undefined: case '': case 'all': break;
    default: throw new HttpError(400, 'Unknown view');
  }
  return { where: where.join(' AND '), params };
}

const SORTS = {
  ticket_no: 't.id', subject: 't.subject', status: 't.status', created_at: 't.created_at', updated_at: 't.updated_at',
  sla_resolution_due: "COALESCE(t.sla_resolution_due, '9999')", department: 'd.name', assigned: 'au.name',
  priority: "CASE t.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END",
  age: 't.created_at',
};

const SELECT_COLS = `t.id, t.ticket_no, t.subject, t.status, t.priority, t.quote_no, t.sales_order_no, t.customer_name, t.order_stage,
  t.created_at, t.updated_at, t.sla_resolution_due, t.sla_first_response_due, t.first_response_at, t.resolved_at, t.closed_at, t.reopen_count,
  c.name AS category_name, c.is_software, s.name AS subcategory_name, d.name AS department_name, t.department_id,
  au.name AS assigned_name, t.assigned_user_id, ru.name AS requester_name, dl.name AS dealer_name,
  CASE WHEN ${OVERDUE} THEN 1 ELSE 0 END AS is_overdue`;

module.exports = { buildWhere, BASE_FROM, SORTS, SELECT_COLS, OPEN_IN, OVERDUE };
