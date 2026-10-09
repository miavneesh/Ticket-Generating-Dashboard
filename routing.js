// Determines the responsible department for a new ticket.
// Order: active routing rules (by rank) → subcategory override → category default → central triage queue.
const { getDb } = require('../db');

function triageDept() {
  return getDb().prepare('SELECT id FROM departments WHERE is_triage = 1 AND is_active = 1 ORDER BY id LIMIT 1').get();
}

function route({ category_id, subcategory_id, order_stage, priority }) {
  const db = getDb();
  const rule = db.prepare(`
    SELECT r.* FROM routing_rules r JOIN departments d ON d.id = r.department_id AND d.is_active = 1
    WHERE r.is_active = 1
      AND (r.category_id IS NULL OR r.category_id = ?)
      AND (r.subcategory_id IS NULL OR r.subcategory_id = ?)
      AND (r.order_stage IS NULL OR r.order_stage = ?)
      AND (r.priority IS NULL OR r.priority = ?)
      AND (r.category_id IS NOT NULL OR r.subcategory_id IS NOT NULL OR r.order_stage IS NOT NULL)
    ORDER BY r.rank ASC, r.id ASC LIMIT 1`).get(category_id ?? -1, subcategory_id ?? -1, order_stage ?? '', priority ?? '');
  if (rule) return { department_id: rule.department_id, assign_user_id: rule.assign_user_id, routed_by: 'rule' };

  if (subcategory_id) {
    const sc = db.prepare(`SELECT s.department_id FROM ticket_subcategories s JOIN departments d ON d.id = s.department_id AND d.is_active = 1 WHERE s.id = ?`).get(subcategory_id);
    if (sc?.department_id) return { department_id: sc.department_id, routed_by: 'subcategory' };
  }
  const cat = db.prepare(`SELECT c.department_id FROM ticket_categories c JOIN departments d ON d.id = c.department_id AND d.is_active = 1 WHERE c.id = ?`).get(category_id);
  if (cat?.department_id) return { department_id: cat.department_id, routed_by: 'category' };

  const t = triageDept();
  if (!t) throw new Error('No triage department configured');
  return { department_id: t.id, routed_by: 'triage' };
}

module.exports = { route, triageDept };
