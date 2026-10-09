// SLA calculation. Targets come from the sla_policies table and are CONFIGURABLE —
// the seeded values are suggestions pending Ozone management approval.
const { getDb } = require('../db');
const { getSettings } = require('./settings');

function findPolicy({ priority, department_id, category_id }) {
  return getDb().prepare(`
    SELECT * FROM sla_policies
    WHERE is_active = 1 AND priority = ?
      AND (department_id IS NULL OR department_id = ?)
      AND (category_id IS NULL OR category_id = ?)
    ORDER BY (category_id IS NOT NULL) DESC, (department_id IS NOT NULL) DESC, id ASC LIMIT 1`).get(priority, department_id ?? -1, category_id ?? -1);
}

const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** Add working minutes using working hours, working days and holidays (fixed-offset local time). */
function addBusinessMinutes(start, minutes, s = getSettings()) {
  if (s.sla_clock !== 'business') return new Date(start.getTime() + minutes * 60000);
  const off = Number(s.tz_offset_minutes) * 60000;
  const ws = hm(s.work_start), we = hm(s.work_end);
  const days = new Set(s.work_days.split(',').map(Number));
  const holidays = new Set(getDb().prepare('SELECT date FROM holidays').all().map((h) => h.date));
  let cur = new Date(start.getTime() + off); // shifted: read with UTC getters as local time
  let remaining = minutes;
  const dayStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  for (let guard = 0; guard < 4000; guard++) {
    const ds = dayStart(cur);
    const iso = ds.toISOString().slice(0, 10);
    const minuteOfDay = cur.getUTCHours() * 60 + cur.getUTCMinutes();
    if (!days.has(cur.getUTCDay()) || holidays.has(iso) || minuteOfDay >= we) {
      cur = new Date(ds.getTime() + 86400000 + ws * 60000);
      continue;
    }
    if (minuteOfDay < ws) cur = new Date(ds.getTime() + ws * 60000);
    const avail = we - (cur.getUTCHours() * 60 + cur.getUTCMinutes());
    if (remaining <= avail) return new Date(cur.getTime() + remaining * 60000 - off);
    remaining -= avail;
    cur = new Date(ds.getTime() + 86400000 + ws * 60000);
  }
  return new Date(start.getTime() + minutes * 60000);
}

function computeDue({ priority, department_id, category_id, created_at }) {
  const p = findPolicy({ priority, department_id, category_id });
  if (!p) return { sla_policy_id: null, sla_first_response_due: null, sla_resolution_due: null };
  const start = new Date(created_at);
  return {
    sla_policy_id: p.id,
    sla_first_response_due: addBusinessMinutes(start, p.first_response_minutes).toISOString(),
    sla_resolution_due: addBusinessMinutes(start, p.resolution_minutes).toISOString(),
  };
}

module.exports = { findPolicy, computeDue, addBusinessMinutes };
