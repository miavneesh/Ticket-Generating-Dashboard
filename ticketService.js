// Core ticket business logic. All mutations go through here so history, audit and notifications stay consistent.
const { z } = require('zod');
const { getDb } = require('../db');
const { HttpError, nowIso, parseJson, clean } = require('./util');
const { STATUSES, TRANSITIONS, REMARKS_REQUIRED, PRIORITIES, FIELD_KEYS, FIELD_DEFS } = require('./constants');
const P = require('./permissions');
const { route, triageDept } = require('./routing');
const { computeDue } = require('./sla');
const { notify, deptManagers, deptStaff } = require('./notify');
const { audit } = require('./audit');
const { getSettings } = require('./settings');

const db = () => getDb();

// ---------- helpers ----------
function loadTicket(idOrNo) {
  const s = String(idOrNo);
  const t = /^\d+$/.test(s)
    ? db().prepare('SELECT * FROM tickets WHERE id = ?').get(Number(s))
    : db().prepare('SELECT * FROM tickets WHERE ticket_no = ?').get(s.toUpperCase());
  if (!t) throw new HttpError(404, 'Ticket not found');
  return t;
}

/** Load + authorize. Returns 404 (not 403) for invisible tickets so IDs can't be probed. */
function loadVisible(user, idOrNo) {
  let t;
  try { t = loadTicket(idOrNo); } catch (e) { throw e; }
  if (!P.canView(user, t)) throw new HttpError(404, 'Ticket not found');
  return t;
}

function nextTicketNo(at) {
  const year = new Date(at).getUTCFullYear();
  const row = db().prepare('SELECT last_value FROM ticket_sequences WHERE year = ?').get(year);
  const next = (row?.last_value || 0) + 1;
  if (row) db().prepare('UPDATE ticket_sequences SET last_value = ? WHERE year = ?').run(next, year);
  else db().prepare('INSERT INTO ticket_sequences (year, last_value) VALUES (?, ?)').run(year, next);
  return `OZ-${year}-${String(next).padStart(5, '0')}`;
}

function addEvent(ticketId, userId, type, summary, { data, internal = false, at } = {}) {
  db().prepare('INSERT INTO ticket_events (ticket_id, user_id, event_type, is_internal, summary, data, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(ticketId, userId ?? null, type, internal ? 1 : 0, summary, data ? JSON.stringify(data) : null, at || nowIso());
}

function addHistory(ticketId, from, to, userId, remarks, at) {
  db().prepare('INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by, remarks, created_at) VALUES (?,?,?,?,?,?)')
    .run(ticketId, from, to, userId ?? null, remarks ?? null, at || nowIso());
}

const userName = (id) => (id ? db().prepare('SELECT name FROM users WHERE id = ?').get(id)?.name : null);
const deptName = (id) => (id ? db().prepare('SELECT name FROM departments WHERE id = ?').get(id)?.name : null);
const categoryOf = (t) => db().prepare('SELECT * FROM ticket_categories WHERE id = ?').get(t.category_id);

function update(t, fields, at) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  fields.updated_at = at || nowIso();
  const cols = Object.keys(fields);
  db().prepare(`UPDATE tickets SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => fields[k]), t.id);
  Object.assign(t, fields);
}

const optStr = (max) => z.preprocess(clean, z.string().max(max).nullable().optional());
const optId = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().positive().nullable().optional());

const createSchema = z.object({
  subject: z.string().trim().min(5, 'Subject must be at least 5 characters').max(200),
  description: z.string().trim().min(10, 'Please describe the problem (at least 10 characters)').max(10000),
  category_id: z.coerce.number().int().positive({ message: 'Select an issue category' }),
  subcategory_id: optId,
  priority: z.enum(PRIORITIES).default('Medium'),
  department_id: optId,
  assigned_user_id: optId,
  dealer_id: optId,
  customer_id: optId,
  customer_name: optStr(200),
  project_location: optStr(200),
  quote_no: optStr(60),
  sales_order_no: optStr(60),
  survey_ref: optStr(60),
  production_order_no: optStr(60),
  order_stage: optStr(60),
  customer_impact: optStr(2000),
  expected_resolution_date: z.preprocess(clean, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional()),
  related_ticket_no: optStr(30),
});

function fieldError(field, message) {
  return new HttpError(400, message, { [field]: message });
}

// ---------- create ----------
function createTicket(user, input, { at } = {}) {
  const data = createSchema.parse(input);
  const now = at || nowIso();
  const conn = db();

  const cat = conn.prepare('SELECT * FROM ticket_categories WHERE id = ? AND is_active = 1').get(data.category_id);
  if (!cat) throw fieldError('category_id', 'Select a valid issue category');
  let sub = null;
  if (data.subcategory_id) {
    sub = conn.prepare('SELECT * FROM ticket_subcategories WHERE id = ? AND category_id = ? AND is_active = 1').get(data.subcategory_id, cat.id);
    if (!sub) throw fieldError('subcategory_id', 'Subcategory does not belong to this category');
  }

  // Dealer isolation: dealers can only raise tickets for themselves and their own customers
  if (user.role === 'dealer') data.dealer_id = user.dealer_id;
  if (data.dealer_id && !conn.prepare('SELECT 1 FROM dealers WHERE id = ? AND is_active = 1').get(data.dealer_id)) throw fieldError('dealer_id', 'Unknown dealer');
  if (data.customer_id) {
    const c = conn.prepare('SELECT * FROM customers WHERE id = ?').get(data.customer_id);
    if (!c) throw fieldError('customer_id', 'Unknown customer');
    if (user.role === 'dealer' && c.dealer_id !== user.dealer_id) throw fieldError('customer_id', 'Customer not found');
    data.customer_name = data.customer_name || c.name;
    data.project_location = data.project_location || c.location;
    if (!data.dealer_id && c.dealer_id) data.dealer_id = c.dealer_id;
  }
  if (data.order_stage && !conn.prepare('SELECT 1 FROM order_stages WHERE name = ?').get(data.order_stage)) throw fieldError('order_stage', 'Unknown order stage');

  let related = null;
  if (data.related_ticket_no) {
    related = conn.prepare('SELECT * FROM tickets WHERE ticket_no = ?').get(data.related_ticket_no.toUpperCase());
    if (!related || !P.canView(user, related)) throw fieldError('related_ticket_no', 'Related ticket not found');
  }

  // Category-configurable mandatory fields
  const required = parseJson(cat.required_fields, []);
  const missing = {};
  for (const key of required) {
    const v = key === 'related_ticket_no' ? related : data[key];
    if (v === null || v === undefined || v === '') missing[key] = `${FIELD_DEFS.find((f) => f.key === key)?.label || key} is required for ${cat.name}`;
  }
  if (Object.keys(missing).length) throw new HttpError(400, 'Please complete the required fields', missing);

  // Routing — explicit department choice wins, otherwise rules → defaults → triage
  let routing;
  if (data.department_id) {
    if (!conn.prepare('SELECT 1 FROM departments WHERE id = ? AND is_active = 1').get(data.department_id)) throw fieldError('department_id', 'Unknown department');
    routing = { department_id: data.department_id, routed_by: 'manual' };
  } else {
    routing = route({ category_id: cat.id, subcategory_id: sub?.id, order_stage: data.order_stage, priority: data.priority });
  }

  // Assignee: only staff who can work the target department may pick one
  let assignee = data.assigned_user_id || routing.assign_user_id || null;
  if (data.assigned_user_id) {
    const canPick = P.isAdmin(user) || (P.isStaff(user) && user.department_id === routing.department_id);
    if (!canPick) throw fieldError('assigned_user_id', 'You cannot assign tickets in that department');
  }
  if (assignee) {
    const a = staffInDept(assignee, routing.department_id);
    if (!a) throw fieldError('assigned_user_id', 'Assignee must be an active member of the responsible department');
  }

  const isTriage = !!conn.prepare('SELECT is_triage FROM departments WHERE id = ?').get(routing.department_id)?.is_triage;
  const status = isTriage && !assignee ? 'Submitted' : 'Assigned';
  const sla = computeDue({ priority: data.priority, department_id: routing.department_id, category_id: cat.id, created_at: now });
  const ticket_no = nextTicketNo(now);

  const info = conn.prepare(`INSERT INTO tickets (
      ticket_no, subject, description, requester_id, requester_department_id, requester_role, dealer_id, customer_id, customer_name,
      project_location, quote_no, sales_order_no, survey_ref, production_order_no, order_stage, category_id, subcategory_id,
      department_id, priority, status, assigned_user_id, expected_resolution_date, customer_impact, related_ticket_id, routed_by,
      sla_policy_id, sla_first_response_due, sla_resolution_due, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ticket_no, data.subject, data.description, user.id, user.department_id ?? null, user.role, data.dealer_id ?? null, data.customer_id ?? null,
    data.customer_name ?? null, data.project_location ?? null, data.quote_no ?? null, data.sales_order_no ?? null, data.survey_ref ?? null,
    data.production_order_no ?? null, data.order_stage ?? null, cat.id, sub?.id ?? null, routing.department_id, data.priority, status,
    assignee, data.expected_resolution_date ?? null, data.customer_impact ?? null, related?.id ?? null, routing.routed_by,
    sla.sla_policy_id, sla.sla_first_response_due, sla.sla_resolution_due, now, now);
  const id = info.lastInsertRowid;

  addHistory(id, null, 'New', user.id, 'Ticket created', now);
  addEvent(id, user.id, 'created', `Ticket created by ${user.name}`, { at: now });
  const routeMsg = routing.routed_by === 'triage' ? 'Sent to central triage queue for manual assignment' : `Routed to ${deptName(routing.department_id)} (${routing.routed_by})`;
  addHistory(id, 'New', status, null, routeMsg, now);
  addEvent(id, null, 'status', `Status New → ${status}. ${routeMsg}`, { at: now, data: { from: 'New', to: status } });
  if (assignee) {
    conn.prepare('INSERT INTO ticket_assignments (ticket_id, department_id, from_user_id, to_user_id, assigned_by, reason, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, routing.department_id, null, assignee, user.id, 'Assigned at creation', now);
    addEvent(id, user.id, 'assigned', `Assigned to ${userName(assignee)}`, { at: now });
  }
  audit(user.id, 'ticket.create', 'ticket', ticket_no, { department_id: routing.department_id, routed_by: routing.routed_by });

  const t = loadTicket(id);
  notify([user.id], { type: 'ticket_created', ticket: t, title: `${ticket_no} registered`, body: `Your ticket "${t.subject}" was ${routeMsg.toLowerCase()}.` });
  notify([...deptManagers(t.department_id), ...(isTriage ? deptStaff(t.department_id) : []), assignee], {
    type: assignee ? 'ticket_assigned' : 'ticket_created', ticket: t, actorId: user.id,
    title: `New ${t.priority} ticket ${ticket_no}`, body: t.subject,
  });
  return t;
}

function staffInDept(userId, deptId) {
  return db().prepare(`SELECT u.* FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND u.is_active = 1 AND r.code IN ('agent','manager') AND u.department_id = ?`).get(userId, deptId);
}

// ---------- status workflow ----------
function allowedTransitions(user, t) {
  const out = [];
  const work = P.canWork(user, t);
  const reqSide = P.isRequesterSide(user, t);
  const cat = categoryOf(t);
  for (const to of STATUSES) {
    if (to === t.status) continue;
    if (checkTransition(user, t, to, { work, reqSide, cat }).ok) out.push(to);
  }
  return out;
}

function checkTransition(user, t, to, { work, reqSide, cat }) {
  const from = t.status;
  const approval = !!cat?.requires_closure_approval;
  if (work && (TRANSITIONS[from] || []).includes(to)) {
    if (to === 'Closed' && approval && !P.canManage(user, t)) return { ok: false, msg: 'Closure of this category requires department head approval' };
    if (to === 'New') return { ok: false };
    return { ok: true };
  }
  if (reqSide) {
    if (from === 'Resolved' && to === 'Closed') return approval ? { ok: false, msg: 'Closure of this category requires department head approval' } : { ok: true };
    if (from === 'Resolved' && to === 'In Progress') return { ok: true };
    if (from === 'Closed' && to === 'In Progress') {
      const days = Number(getSettings().reopen_window_days);
      const closed = t.closed_at ? new Date(t.closed_at).getTime() : 0;
      if (Date.now() - closed > days * 86400000) return { ok: false, msg: `Tickets can only be reopened within ${days} days of closure. Please raise a new ticket and link this one.` };
      return { ok: true };
    }
  }
  return { ok: false, msg: `You cannot move this ticket from ${from} to ${to}` };
}

const statusSchema = z.object({
  status: z.enum(STATUSES),
  remarks: optStr(5000),
  resolution_summary: optStr(5000),
  root_cause: optStr(2000),
  corrective_action: optStr(2000),
});

function changeStatus(user, t, input, { at, system = false } = {}) {
  const data = statusSchema.parse(input);
  const to = data.status;
  const from = t.status;
  const now = at || nowIso();
  if (from === to) throw new HttpError(400, `Ticket is already ${to}`);
  const work = system || P.canWork(user, t);
  const reqSide = !system && P.isRequesterSide(user, t);
  const cat = categoryOf(t);
  if (!system) {
    const chk = checkTransition(user, t, to, { work, reqSide, cat });
    if (!chk.ok) throw new HttpError(403, chk.msg || 'Not allowed');
  }
  const reopening = (from === 'Resolved' || from === 'Closed') && to === 'In Progress';
  if ((REMARKS_REQUIRED.has(to) || reopening) && !data.remarks) throw fieldError('remarks', reopening ? 'Please explain why the issue is not resolved' : `Remarks are required when moving to ${to}`);

  const fields = { status: to };
  if (to === 'Resolved') {
    const summary = data.resolution_summary || t.resolution_summary;
    const root = data.root_cause || t.root_cause;
    if (!summary) throw fieldError('resolution_summary', 'Resolution details are required to resolve a ticket');
    if (!root) throw fieldError('root_cause', 'Root cause is required to resolve a ticket');
    Object.assign(fields, { resolution_summary: summary, root_cause: root, corrective_action: data.corrective_action || t.corrective_action, resolved_at: now });
  }
  if (to === 'Closed') {
    if (!t.resolution_summary) throw new HttpError(400, 'A ticket cannot be closed without recorded resolution details. Resolve it first.');
    Object.assign(fields, { closed_at: now, closed_by: user?.id ?? null });
  }
  if (reopening) Object.assign(fields, { resolved_at: null, closed_at: null, closed_by: null, reopen_count: t.reopen_count + 1 });

  // Auto-take ownership when a staff member starts work on an unassigned ticket
  if (to === 'In Progress' && !t.assigned_user_id && user && !reopening && staffInDept(user.id, t.department_id)) {
    fields.assigned_user_id = user.id;
    db().prepare('INSERT INTO ticket_assignments (ticket_id, department_id, from_user_id, to_user_id, assigned_by, reason, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(t.id, t.department_id, null, user.id, user.id, 'Self-assigned on starting work', now);
    addEvent(t.id, user.id, 'assigned', `${user.name} took ownership`, { at: now });
  }

  // SLA pause/resume (policy-driven)
  const pol = t.sla_policy_id ? db().prepare('SELECT * FROM sla_policies WHERE id = ?').get(t.sla_policy_id) : null;
  const pausesOn = (s) => (s === 'Awaiting Information' && pol?.pause_on_awaiting_info) || (s === 'On Hold' && pol?.pause_on_hold);
  if (pausesOn(to) && !t.sla_paused_at) fields.sla_paused_at = now;
  if (t.sla_paused_at && !pausesOn(to)) {
    const mins = Math.max(0, Math.round((new Date(now) - new Date(t.sla_paused_at)) / 60000));
    fields.sla_paused_at = null;
    fields.sla_paused_minutes = t.sla_paused_minutes + mins;
    if (t.sla_resolution_due) fields.sla_resolution_due = new Date(new Date(t.sla_resolution_due).getTime() + mins * 60000).toISOString();
  }
  if (work && !system && !t.first_response_at && user && !P.isRequesterSide(user, t)) fields.first_response_at = now;

  update(t, fields, now);
  addHistory(t.id, from, to, user?.id ?? null, data.remarks, now);
  const who = user ? user.name : 'System';
  const evType = reopening ? 'reopened' : to === 'Resolved' ? 'resolved' : to === 'Closed' ? 'closed' : 'status';
  addEvent(t.id, user?.id, evType, `${who} changed status ${from} → ${to}${data.remarks ? `: ${data.remarks}` : ''}`, { at: now, data: { from, to } });
  if (to === 'Awaiting Information' && data.remarks) {
    db().prepare('INSERT INTO ticket_comments (ticket_id, user_id, body, is_internal, kind, created_at) VALUES (?,?,?,?,?,?)').run(t.id, user.id, data.remarks, 0, 'info_request', now);
  }
  if (!system) audit(user.id, 'ticket.status', 'ticket', t.ticket_no, { from, to });

  const typeMap = { 'Awaiting Information': 'info_requested', Escalated: 'ticket_escalated', Resolved: 'ticket_resolved', Closed: 'ticket_closed' };
  const type = reopening ? 'ticket_reopened' : typeMap[to] || 'status_changed';
  const recipients = [t.requester_id, t.assigned_user_id];
  if (to === 'Escalated' || reopening || to === 'Closed') recipients.push(...deptManagers(t.department_id));
  notify(recipients, { type, ticket: t, actorId: user?.id, title: `${t.ticket_no}: ${from} → ${to}`, body: data.remarks || t.subject });
  return t;
}

// ---------- assignment & transfer ----------
function assign(user, t, { user_id, reason }, { at } = {}) {
  const now = at || nowIso();
  if (!P.canWork(user, t)) throw new HttpError(403, 'You cannot assign this ticket');
  if (['Resolved', 'Closed'].includes(t.status)) throw new HttpError(400, 'Reopen the ticket before reassigning');
  const target = user_id ? Number(user_id) : null;
  const manage = P.canManage(user, t);
  if (!manage && t.assigned_user_id && t.assigned_user_id !== user.id) throw new HttpError(403, 'Only the department head can reassign a ticket owned by someone else');
  if (!target && !manage) throw new HttpError(403, 'Only the department head can unassign');
  if (target && !staffInDept(target, t.department_id)) throw fieldError('user_id', 'Assignee must be an active member of the responsible department. Use Transfer to move to another department.');
  if (target === t.assigned_user_id) throw new HttpError(400, 'Ticket is already assigned to this person');

  const prev = t.assigned_user_id;
  const fields = { assigned_user_id: target };
  update(t, fields, now);
  db().prepare('INSERT INTO ticket_assignments (ticket_id, department_id, from_user_id, to_user_id, assigned_by, reason, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(t.id, t.department_id, prev, target, user.id, clean(reason), now);
  const summary = target ? `${prev ? `Reassigned from ${userName(prev)} to` : 'Assigned to'} ${userName(target)}` : `Unassigned from ${userName(prev)}`;
  addEvent(t.id, user.id, 'assigned', `${summary}${reason ? ` — ${reason}` : ''}`, { at: now });
  if (['New', 'Submitted'].includes(t.status) && target) {
    const from = t.status;
    update(t, { status: 'Assigned' }, now);
    addHistory(t.id, from, 'Assigned', user.id, summary, now);
    addEvent(t.id, user.id, 'status', `Status ${from} → Assigned`, { at: now, data: { from, to: 'Assigned' } });
  }
  audit(user.id, 'ticket.assign', 'ticket', t.ticket_no, { from: prev, to: target });
  notify([target], { type: prev ? 'ticket_reassigned' : 'ticket_assigned', ticket: t, actorId: user.id, title: `${t.ticket_no} assigned to you`, body: t.subject });
  if (prev) notify([prev], { type: 'ticket_reassigned', ticket: t, actorId: user.id, title: `${t.ticket_no} reassigned`, body: summary, staffOnly: true });
  notify([t.requester_id], { type: 'ticket_assigned', ticket: t, actorId: user.id, title: `${t.ticket_no} is being handled`, body: `Assigned within ${deptName(t.department_id)}` });
  return t;
}

function transfer(user, t, { department_id, reason }, { at } = {}) {
  const now = at || nowIso();
  if (!P.canWork(user, t)) throw new HttpError(403, 'You cannot transfer this ticket');
  if (['Resolved', 'Closed'].includes(t.status)) throw new HttpError(400, 'Reopen the ticket before transferring');
  const why = clean(reason);
  if (!why || why.length < 5) throw fieldError('reason', 'Please give a reason for the transfer');
  const to = db().prepare('SELECT * FROM departments WHERE id = ? AND is_active = 1').get(Number(department_id));
  if (!to) throw fieldError('department_id', 'Select a valid department');
  if (to.id === t.department_id) throw fieldError('department_id', 'Ticket is already with this department');

  const fromDept = t.department_id;
  const prevAssignee = t.assigned_user_id;
  const newStatus = to.is_triage ? 'Submitted' : 'Assigned';
  const from = t.status;
  update(t, { department_id: to.id, assigned_user_id: null, transfer_count: t.transfer_count + 1, status: newStatus }, now);
  db().prepare('INSERT INTO ticket_transfers (ticket_id, from_department_id, to_department_id, transferred_by, reason, created_at) VALUES (?,?,?,?,?,?)')
    .run(t.id, fromDept, to.id, user.id, why, now);
  db().prepare('INSERT INTO ticket_assignments (ticket_id, department_id, from_user_id, to_user_id, assigned_by, reason, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(t.id, to.id, prevAssignee, null, user.id, `Transferred: ${why}`, now);
  addEvent(t.id, user.id, 'transferred', `Transferred from ${deptName(fromDept)} to ${to.name}: ${why}`, { at: now, data: { from: fromDept, to: to.id } });
  if (from !== newStatus) {
    addHistory(t.id, from, newStatus, user.id, `Transferred to ${to.name}`, now);
    addEvent(t.id, user.id, 'status', `Status ${from} → ${newStatus}`, { at: now, data: { from, to: newStatus } });
  }
  audit(user.id, 'ticket.transfer', 'ticket', t.ticket_no, { from: fromDept, to: to.id, reason: why });
  notify([...deptStaff(to.id)], { type: 'ticket_assigned', ticket: t, actorId: user.id, title: `${t.ticket_no} transferred to ${to.name}`, body: why, staffOnly: true });
  notify([prevAssignee], { type: 'ticket_reassigned', ticket: t, actorId: user.id, title: `${t.ticket_no} moved to ${to.name}`, body: why, staffOnly: true });
  notify([t.requester_id], { type: 'status_changed', ticket: t, actorId: user.id, title: `${t.ticket_no} moved to ${to.name}`, body: 'Your ticket has been routed to the responsible team.' });
  return t;
}

// ---------- comments ----------
function addComment(user, t, { body, is_internal }, { at } = {}) {
  const now = at || nowIso();
  const text = clean(body);
  if (!text) throw fieldError('body', 'Comment cannot be empty');
  if (text.length > 10000) throw fieldError('body', 'Comment is too long');
  const internal = is_internal === true || is_internal === 'true' || is_internal === 1 || is_internal === '1';
  if (internal && !P.canSeeInternal(user, t)) throw new HttpError(403, 'Only Ozone support staff can add internal notes');
  const info = db().prepare('INSERT INTO ticket_comments (ticket_id, user_id, body, is_internal, kind, created_at) VALUES (?,?,?,?,?,?)')
    .run(t.id, user.id, text, internal ? 1 : 0, 'comment', now);
  addEvent(t.id, user.id, internal ? 'note' : 'comment', `${user.name} added ${internal ? 'an internal note' : 'a comment'}`, { at: now, internal, data: { comment_id: Number(info.lastInsertRowid) } });
  const reqSide = P.isRequesterSide(user, t);
  const fields = {};
  if (!internal && !reqSide && P.canWork(user, t) && !t.first_response_at) fields.first_response_at = now;
  update(t, fields, now);
  audit(user.id, internal ? 'ticket.note' : 'ticket.comment', 'ticket', t.ticket_no);

  if (internal) {
    notify([t.assigned_user_id, ...deptManagers(t.department_id)], { type: 'comment_added', ticket: t, actorId: user.id, title: `Internal note on ${t.ticket_no}`, body: text.slice(0, 140), staffOnly: true });
  } else {
    const owners = t.assigned_user_id ? [t.assigned_user_id] : deptManagers(t.department_id);
    notify([t.requester_id, ...owners], { type: 'comment_added', ticket: t, actorId: user.id, title: `New comment on ${t.ticket_no}`, body: text.slice(0, 140) });
    // Requester supplied the requested information → resume work automatically
    if (reqSide && t.status === 'Awaiting Information') {
      changeStatus(user, t, { status: 'In Progress', remarks: 'Requester provided additional information' }, { at: now, system: true });
    }
  }
  return Number(info.lastInsertRowid);
}

// ---------- edit ----------
const editable = ['subject', 'description', 'priority', 'category_id', 'subcategory_id', 'customer_name', 'project_location', 'quote_no', 'sales_order_no', 'survey_ref', 'production_order_no', 'order_stage', 'customer_impact', 'expected_resolution_date'];
const requesterEditable = new Set(['customer_name', 'project_location', 'quote_no', 'sales_order_no', 'survey_ref', 'production_order_no', 'customer_impact']);

function editTicket(user, t, input, { at } = {}) {
  const now = at || nowIso();
  const work = P.canWork(user, t);
  const reqSide = P.isRequesterSide(user, t);
  if (!work && !reqSide) throw new HttpError(403, 'You cannot edit this ticket');
  if (t.status === 'Closed') throw new HttpError(400, 'Closed tickets cannot be edited');
  const partial = createSchema.partial().parse(input);
  const changes = {};
  for (const k of editable) {
    if (!(k in input)) continue;
    if (!work && !requesterEditable.has(k)) throw new HttpError(403, `You cannot change ${k}`);
    const v = partial[k] ?? null;
    if (v !== t[k]) changes[k] = v;
  }
  if (changes.category_id || changes.subcategory_id) {
    const catId = changes.category_id || t.category_id;
    if (!db().prepare('SELECT 1 FROM ticket_categories WHERE id = ? AND is_active = 1').get(catId)) throw fieldError('category_id', 'Invalid category');
    const subId = 'subcategory_id' in changes ? changes.subcategory_id : t.subcategory_id;
    if (subId && !db().prepare('SELECT 1 FROM ticket_subcategories WHERE id = ? AND category_id = ?').get(subId, catId)) throw fieldError('subcategory_id', 'Subcategory does not belong to this category');
  }
  if (!Object.keys(changes).length) return t;
  if ('subject' in changes && !changes.subject) throw fieldError('subject', 'Subject is required');
  if ('description' in changes && !changes.description) throw fieldError('description', 'Description is required');
  const before = Object.fromEntries(Object.keys(changes).map((k) => [k, t[k]]));
  if (changes.priority) Object.assign(changes, (({ sla_policy_id, sla_first_response_due, sla_resolution_due }) => ({ sla_policy_id, sla_first_response_due, sla_resolution_due }))(computeDue({ priority: changes.priority, department_id: t.department_id, category_id: changes.category_id || t.category_id, created_at: t.created_at })));
  update(t, changes, now);
  const labels = Object.keys(before).map((k) => k.replace(/_/g, ' ')).join(', ');
  addEvent(t.id, user.id, 'updated', `${user.name} updated ${labels}`, { at: now, data: { before, after: Object.fromEntries(Object.keys(before).map((k) => [k, t[k]])) } });
  audit(user.id, 'ticket.update', 'ticket', t.ticket_no, { fields: Object.keys(before) });
  return t;
}

// ---------- detail ----------
function getDetail(user, t) {
  const conn = db();
  const internal = P.canSeeInternal(user, t);
  const ticket = conn.prepare(`
    SELECT t.*, c.name AS category_name, c.is_software, c.requires_closure_approval, s.name AS subcategory_name, d.name AS department_name,
      au.name AS assigned_name, ru.name AS requester_name, ru.email AS requester_email, rd.name AS requester_department_name,
      dl.name AS dealer_name, dl.code AS dealer_code, rt.ticket_no AS related_ticket_no, cu.name AS closed_by_name
    FROM tickets t
    JOIN ticket_categories c ON c.id = t.category_id
    LEFT JOIN ticket_subcategories s ON s.id = t.subcategory_id
    JOIN departments d ON d.id = t.department_id
    LEFT JOIN users au ON au.id = t.assigned_user_id
    JOIN users ru ON ru.id = t.requester_id
    LEFT JOIN departments rd ON rd.id = t.requester_department_id
    LEFT JOIN dealers dl ON dl.id = t.dealer_id
    LEFT JOIN tickets rt ON rt.id = t.related_ticket_id
    LEFT JOIN users cu ON cu.id = t.closed_by
    WHERE t.id = ?`).get(t.id);

  const vis = internal ? '' : 'AND is_internal = 0';
  const comments = conn.prepare(`SELECT cm.id, cm.body, cm.is_internal, cm.kind, cm.created_at, u.name AS user_name, r.code AS user_role
    FROM ticket_comments cm JOIN users u ON u.id = cm.user_id JOIN roles r ON r.id = u.role_id WHERE cm.ticket_id = ? ${vis.replace('is_internal', 'cm.is_internal')} ORDER BY cm.created_at, cm.id`).all(t.id);
  const attachments = conn.prepare(`SELECT a.id, a.comment_id, a.original_name, a.mime_type, a.size_bytes, a.is_internal, a.created_at, u.name AS user_name
    FROM ticket_attachments a JOIN users u ON u.id = a.user_id WHERE a.ticket_id = ? ${vis.replace('is_internal', 'a.is_internal')} ORDER BY a.created_at, a.id`).all(t.id);
  const events = conn.prepare(`SELECT e.id, e.event_type, e.is_internal, e.summary, e.created_at, e.data, u.name AS user_name
    FROM ticket_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.ticket_id = ? ${vis.replace('is_internal', 'e.is_internal')} ORDER BY e.created_at, e.id`).all(t.id)
    .map((e) => ({ ...e, data: parseJson(e.data, null) }));
  const status_history = conn.prepare(`SELECT h.from_status, h.to_status, h.remarks, h.created_at, COALESCE(u.name, 'System') AS user_name
    FROM ticket_status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.ticket_id = ? ORDER BY h.created_at, h.id`).all(t.id);
  const assignments = conn.prepare(`SELECT a.created_at, a.reason, d.name AS department_name, fu.name AS from_name, tu.name AS to_name, bu.name AS by_name
    FROM ticket_assignments a LEFT JOIN departments d ON d.id = a.department_id LEFT JOIN users fu ON fu.id = a.from_user_id
    LEFT JOIN users tu ON tu.id = a.to_user_id LEFT JOIN users bu ON bu.id = a.assigned_by WHERE a.ticket_id = ? ORDER BY a.created_at, a.id`).all(t.id);
  const transfers = conn.prepare(`SELECT tr.created_at, tr.reason, fd.name AS from_department, td.name AS to_department, u.name AS by_name
    FROM ticket_transfers tr LEFT JOIN departments fd ON fd.id = tr.from_department_id JOIN departments td ON td.id = tr.to_department_id
    JOIN users u ON u.id = tr.transferred_by WHERE tr.ticket_id = ? ORDER BY tr.created_at, tr.id`).all(t.id);
  const relatedRaw = conn.prepare(`SELECT * FROM tickets WHERE (id = ? OR related_ticket_id = ?) AND id != ?`).all(t.related_ticket_id ?? -1, t.id, t.id);
  const related = relatedRaw.filter((r) => P.canView(user, r)).map((r) => ({ id: r.id, ticket_no: r.ticket_no, subject: r.subject, status: r.status, priority: r.priority }));

  if (!internal) {
    // External/requester view: hide internal routing metadata
    delete ticket.routed_by;
    delete ticket.sla_policy_id;
  }
  const work = P.canWork(user, t);
  const permissions = {
    canWork: work,
    canManage: P.canManage(user, t),
    canSeeInternal: internal,
    isRequesterSide: P.isRequesterSide(user, t),
    transitions: allowedTransitions(user, t),
    canAssign: work && !['Resolved', 'Closed'].includes(t.status),
    canTransfer: work && !['Resolved', 'Closed'].includes(t.status),
    canComment: true,
    canEdit: (work || P.isRequesterSide(user, t)) && t.status !== 'Closed',
  };
  return { ticket, comments, attachments, events, status_history, assignments, transfers, related, permissions };
}

module.exports = {
  loadTicket, loadVisible, createTicket, changeStatus, assign, transfer, addComment, editTicket, getDetail, allowedTransitions, addEvent, FIELD_KEYS,
};
