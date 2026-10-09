// Central, server-side authorization rules. Every route uses these — never the client.
const { getDb } = require('../db');

const STAFF = new Set(['agent', 'manager', 'admin']);

const isStaff = (u) => STAFF.has(u.role);
const isAdmin = (u) => u.role === 'admin';
const seesAll = (u) => u.role === 'admin' || (u.role === 'manager' && !!u.dept_sees_all);

/** SQL fragment restricting tickets (alias t) to what the user may see. */
function visibilitySql(u) {
  if (seesAll(u)) return { sql: '1=1', params: [] };
  if (u.role === 'dealer') return u.dealer_id ? { sql: 't.dealer_id = ?', params: [u.dealer_id] } : { sql: '0', params: [] };
  if (u.role === 'creator') return { sql: '(t.requester_id = ? OR t.assigned_user_id = ?)', params: [u.id, u.id] };
  // agent / manager: own department, tickets they raised or hold, and tickets their department transferred out (read-only history)
  return {
    sql: `(t.department_id = ? OR t.requester_id = ? OR t.assigned_user_id = ?
           OR EXISTS (SELECT 1 FROM ticket_transfers tr WHERE tr.ticket_id = t.id AND tr.from_department_id = ?))`,
    params: [u.department_id ?? -1, u.id, u.id, u.department_id ?? -1],
  };
}

function canView(u, t) {
  if (!t) return false;
  if (seesAll(u)) return true;
  if (u.role === 'dealer') return !!u.dealer_id && t.dealer_id === u.dealer_id;
  if (t.requester_id === u.id || t.assigned_user_id === u.id) return true;
  if (u.role === 'creator') return false;
  if (u.department_id && t.department_id === u.department_id) return true;
  return !!getDb()
    .prepare('SELECT 1 FROM ticket_transfers WHERE ticket_id = ? AND from_department_id = ?')
    .get(t.id, u.department_id ?? -1);
}

/** Can perform support-team actions (status, notes, assignment, transfer, resolution). */
function canWork(u, t) {
  if (isAdmin(u)) return true;
  if (!isStaff(u)) return false;
  if (u.department_id && t.department_id === u.department_id) return true;
  return u.role === 'agent' && t.assigned_user_id === u.id;
}

const canManage = (u, t) => isAdmin(u) || (u.role === 'manager' && u.department_id === t.department_id);
const canSeeInternal = (u, t) => isStaff(u) && canView(u, t);

/** Requester side: the person who raised it, or (for dealer tickets) users of that dealer. */
const isRequesterSide = (u, t) => t.requester_id === u.id || (u.role === 'dealer' && u.dealer_id && u.dealer_id === t.dealer_id);

module.exports = { isStaff, isAdmin, seesAll, visibilitySql, canView, canWork, canManage, canSeeInternal, isRequesterSide };
