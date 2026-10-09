// Business-hour SLA calculation (09:30–18:30 IST, Mon–Sat, holidays excluded)
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_FILE = ':memory:';
const { getDb } = require('../src/db');
const { addBusinessMinutes } = require('../src/lib/sla');

before(() => getDb().prepare("INSERT INTO holidays (date, name) VALUES ('2026-10-20', 'Dussehra')").run());
const ist = (s) => new Date(`${s}+05:30`);
const S = { sla_clock: 'business', tz_offset_minutes: '330', work_start: '09:30', work_end: '18:30', work_days: '1,2,3,4,5,6' };

test('rolls over end of day', () => {
  assert.equal(addBusinessMinutes(ist('2026-10-09T17:30:00'), 120, S).toISOString(), ist('2026-10-10T10:30:00').toISOString());
});
test('skips Sunday', () => {
  assert.equal(addBusinessMinutes(ist('2026-10-10T18:00:00'), 60, S).toISOString(), ist('2026-10-12T10:00:00').toISOString());
});
test('starts at opening time when raised before hours', () => {
  assert.equal(addBusinessMinutes(ist('2026-10-12T07:00:00'), 60, S).toISOString(), ist('2026-10-12T10:30:00').toISOString());
});
test('skips configured holidays', () => {
  assert.equal(addBusinessMinutes(ist('2026-10-19T18:00:00'), 60, S).toISOString(), ist('2026-10-21T10:00:00').toISOString());
});
test('one business day target', () => {
  assert.equal(addBusinessMinutes(ist('2026-10-12T12:00:00'), 540, S).toISOString(), ist('2026-10-13T12:00:00').toISOString());
});
test('calendar mode ignores working hours', () => {
  assert.equal(addBusinessMinutes(ist('2026-10-11T23:00:00'), 60, { ...S, sla_clock: 'calendar' }).toISOString(), ist('2026-10-12T00:00:00').toISOString());
});
