const { getDb } = require('../db');

const DEFAULTS = {
  timezone: 'Asia/Kolkata',
  tz_offset_minutes: '330',
  sla_clock: 'business',          // business | calendar
  work_start: '09:30',
  work_end: '18:30',
  work_days: '1,2,3,4,5,6',       // 0=Sun … 6=Sat
  reopen_window_days: '15',
  sla_warning_percent: '80',
  max_upload_mb: '10',
  company_name: 'Ozone Corp. Pvt. Ltd., Gurgaon',
};

function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULTS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}
const getSetting = (k) => getSettings()[k];

module.exports = { getSettings, getSetting, DEFAULTS };
