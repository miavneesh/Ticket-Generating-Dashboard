// End-to-end API tests for the critical Phase 1 workflows, exercised with multiple roles.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oz-test-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.NODE_ENV = 'test';

const request = require('supertest');
const { getDb } = require('../src/db');
const { seedAll } = require('../src/db/seed');
const { createApp } = require('../src/app');

const H = { 'X-Requested-With': 'OzoneTracker' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');
let app;
const agents = {};

async function as(email) {
  if (agents[email]) return agents[email];
  const a = request.agent(app);
  const r = await a.post('/api/auth/login').set(H).send({ email, password: 'Ozone@123' });
  assert.equal(r.status, 200, `login ${email}`);
  agents[email] = a;
  return a;
}
const ids = (name) => getDb().prepare('SELECT id FROM ticket_categories WHERE name = ?').get(name).id;
const sub = (cat, name) => getDb().prepare('SELECT id FROM ticket_subcategories WHERE category_id = ? AND name = ?').get(ids(cat), name).id;
const dept = (code) => getDb().prepare('SELECT id FROM departments WHERE code = ?').get(code).id;
const dealer = (code) => getDb().prepare('SELECT id FROM dealers WHERE code = ?').get(code).id;

async function create(email, body, files = []) {
  const a = await as(email);
  let req = a.post('/api/tickets').set(H).field('data', JSON.stringify(body));
  for (const [name, buf] of files) req = req.attach('files', buf, name);
  return req;
}

before(() => {
  seedAll(getDb(), { demo: true });
  app = createApp();
});
after(() => { getDb().close(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe('authentication & request safety', () => {
  test('rejects unauthenticated access and bad credentials', async () => {
    assert.equal((await request(app).get('/api/tickets')).status, 401);
    const r = await request(app).post('/api/auth/login').set(H).send({ email: 'admin@ozone.demo', password: 'wrong' });
    assert.equal(r.status, 401);
  });
  test('mutating requests require the CSRF header', async () => {
    const a = await as('nikhil.jain@ozone.demo');
    const r = await a.post('/api/tickets').send({ subject: 'x' });
    assert.equal(r.status, 403);
  });
  test('disabled users cannot sign in', async () => {
    getDb().prepare("UPDATE users SET is_active = 0 WHERE email = 'kavita.rao@ozone.demo'").run();
    const r = await request(app).post('/api/auth/login').set(H).send({ email: 'kavita.rao@ozone.demo', password: 'Ozone@123' });
    assert.equal(r.status, 403);
    getDb().prepare("UPDATE users SET is_active = 1 WHERE email = 'kavita.rao@ozone.demo'").run();
  });
});

describe('ticket creation, IDs and routing', () => {
  test('employee creates a ticket with a unique, sequential, immutable ID routed to the category department', async () => {
    const body = { subject: 'Costing not validated for quote', description: 'Costing validation pending for three days.', category_id: ids('Costing'), subcategory_id: sub('Costing', 'Costing validation pending'), priority: 'High', quote_no: 'QT/TEST/0001' };
    const r1 = await create('nikhil.jain@ozone.demo', body);
    const r2 = await create('nikhil.jain@ozone.demo', body);
    assert.equal(r1.status, 201);
    assert.match(r1.body.ticket_no, /^OZ-\d{4}-\d{5}$/);
    assert.notEqual(r1.body.ticket_no, r2.body.ticket_no);
    assert.equal(Number(r2.body.ticket_no.slice(-5)), Number(r1.body.ticket_no.slice(-5)) + 1);
    assert.equal(r1.body.department_id, dept('COST'));
    assert.equal(r1.body.status, 'Assigned');
    const t = getDb().prepare('SELECT * FROM tickets WHERE id = ?').get(r1.body.id);
    assert.ok(t.sla_first_response_due && t.sla_resolution_due, 'SLA targets computed');
    assert.throws(() => getDb().prepare("UPDATE tickets SET ticket_no = 'OZ-0000-00000' WHERE id = ?").run(t.id), /immutable/);
  });

  test('category-configured mandatory fields are enforced server-side', async () => {
    const r = await create('nikhil.jain@ozone.demo', { subject: 'Wrong production size', description: 'Frames are 20mm undersized.', category_id: ids('Production'), priority: 'High' });
    assert.equal(r.status, 400);
    assert.ok(r.body.details.production_order_no);
  });

  test('routing rules, subcategory overrides and the central triage queue', async () => {
    const pm = await create('sneha.reddy@ozone.demo', { subject: 'Price mismatch in quote', description: 'Quote shows higher price than list.', category_id: ids('Sales'), subcategory_id: sub('Sales', 'Pricing mismatch'), quote_no: 'QT/TEST/0002' });
    assert.equal(pm.body.department_id, dept('COST'), 'routing rule sends pricing mismatch to Costing');
    const sel = await create('rakesh@skyline.demo', { subject: 'Need help selecting hardware', description: 'Which handle suits the casement series?', category_id: ids('Dealer'), subcategory_id: sub('Dealer', 'Product selection assistance') });
    assert.equal(sel.body.department_id, dept('SALES'), 'subcategory override');
    const tri = await create('nikhil.jain@ozone.demo', { subject: 'Not sure who handles this', description: 'Customer wants a catalogue and test reports.', category_id: ids('Other / Not sure') });
    assert.equal(tri.body.department_id, dept('TRIAGE'));
    assert.equal(tri.body.status, 'Submitted');
    const preview = await (await as('nikhil.jain@ozone.demo')).get(`/api/route-preview?category_id=${ids('Sales')}&subcategory_id=${sub('Sales', 'Pricing mismatch')}`);
    assert.equal(preview.body.department_id, dept('COST'));
  });
});

describe('dealer isolation & confidentiality', () => {
  let skylineTicket;
  before(async () => {
    const r = await create('rakesh@skyline.demo', { subject: 'Order entry failing for Villa 14', description: 'Order entry screen rejects the configuration.', category_id: ids('Dealer'), subcategory_id: sub('Dealer', 'Order entry issue'), dealer_id: dealer('DLR-URB') });
    skylineTicket = r.body;
  });

  test('dealer_id is forced to the dealer’s own dealership', () => {
    const t = getDb().prepare('SELECT dealer_id FROM tickets WHERE id = ?').get(skylineTicket.id);
    assert.equal(t.dealer_id, dealer('DLR-SKY'));
  });

  test('another dealer cannot see, list, search or act on it — even by changing the URL', async () => {
    const urb = await as('sameer@urbanwindows.demo');
    assert.equal((await urb.get(`/api/tickets/${skylineTicket.ticket_no}`)).status, 404);
    assert.equal((await urb.get(`/api/tickets/${skylineTicket.id}`)).status, 404);
    assert.equal((await urb.post(`/api/tickets/${skylineTicket.id}/comments`).set(H).field('data', JSON.stringify({ body: 'hello' }))).status, 404);
    assert.equal((await urb.post(`/api/tickets/${skylineTicket.id}/status`).set(H).send({ status: 'Closed' })).status, 404);
    const list = await urb.get('/api/tickets?pageSize=100');
    assert.ok(list.body.rows.length > 0);
    const urbId = dealer('DLR-URB');
    const rows = getDb().prepare(`SELECT dealer_id FROM tickets WHERE ticket_no IN (${list.body.rows.map(() => '?').join(',')})`).all(...list.body.rows.map((x) => x.ticket_no));
    assert.ok(rows.every((x) => x.dealer_id === urbId), 'only own dealer tickets listed');
    const search = await urb.get(`/api/tickets?q=${encodeURIComponent(skylineTicket.ticket_no)}`);
    assert.equal(search.body.total, 0);
    const dash = await urb.get('/api/dashboard?from=2020-01-01');
    assert.equal(dash.body.summary.total, list.body.total, 'dashboard scoped to dealer');
  });

  test('a dealer’s colleague can see the dealership’s tickets', async () => {
    assert.equal((await (await as('divya@skyline.demo')).get(`/api/tickets/${skylineTicket.ticket_no}`)).status, 200);
  });

  test('dealers cannot attach another dealer’s customer', async () => {
    const other = getDb().prepare("SELECT id FROM customers WHERE name = 'Sunrise Heights Society'").get().id;
    const r = await create('rakesh@skyline.demo', { subject: 'Customer problem here', description: 'Testing customer isolation rules.', category_id: ids('Dealer'), customer_id: other });
    assert.equal(r.status, 400);
  });

  test('internal notes and internal attachments are hidden from requesters and dealers', async () => {
    const agent = await as('ritika.joshi@ozone.demo');
    const n = await agent.post(`/api/tickets/${skylineTicket.id}/comments`).set(H).field('data', JSON.stringify({ body: 'SECRET margin discussion', is_internal: true })).attach('files', PNG, 'internal.png');
    assert.equal(n.status, 201);
    const attId = n.body.attachments.find((a) => a.original_name === 'internal.png').id;
    const dl = await as('rakesh@skyline.demo');
    const d = await dl.get(`/api/tickets/${skylineTicket.id}`);
    assert.ok(!JSON.stringify(d.body).includes('SECRET'), 'note body not exposed');
    assert.ok(!d.body.attachments.some((a) => a.id === attId));
    assert.ok(!d.body.events.some((e) => e.is_internal));
    assert.equal((await dl.get(`/api/attachments/${attId}`)).status, 404);
    assert.equal((await agent.get(`/api/attachments/${attId}`)).status, 200);
    const notifs = getDb().prepare("SELECT n.* FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = 'rakesh@skyline.demo' AND n.body LIKE '%SECRET%'").all();
    assert.equal(notifs.length, 0, 'no internal content in dealer notifications');
    const forged = await dl.post(`/api/tickets/${skylineTicket.id}/comments`).set(H).field('data', JSON.stringify({ body: 'trying internal', is_internal: true }));
    assert.equal(forged.status, 403);
  });
});

describe('status workflow, resolution and closure', () => {
  let t;
  before(async () => {
    t = (await create('nikhil.jain@ozone.demo', { subject: 'BOM quantity mismatch on quote', description: 'BOM shows 14 handles for 12 windows.', category_id: ids('Costing'), quote_no: 'QT/TEST/0100' })).body;
  });

  test('staff outside the department cannot update the ticket', async () => {
    const other = await as('karan.mehta@ozone.demo');
    assert.equal((await other.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'In Progress' })).status, 404);
  });

  test('requester cannot perform support-team transitions', async () => {
    const r = await (await as('nikhil.jain@ozone.demo')).post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'Resolved', resolution_summary: 'x', root_cause: 'y' });
    assert.equal(r.status, 403);
  });

  test('request information pauses SLA; requester reply resumes work automatically', async () => {
    const agent = await as('megha.arora@ozone.demo');
    let r = await agent.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'Awaiting Information' });
    assert.equal(r.status, 400, 'remarks required');
    r = await agent.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'Awaiting Information', remarks: 'Are the French doors double-sided?' });
    assert.equal(r.body.ticket.status, 'Awaiting Information');
    assert.ok(r.body.ticket.sla_paused_at);
    assert.ok(r.body.ticket.first_response_at, 'first response recorded');
    const req = await as('nikhil.jain@ozone.demo');
    r = await req.post(`/api/tickets/${t.id}/comments`).set(H).field('data', JSON.stringify({ body: 'Yes, both sides.' }));
    assert.equal(r.body.ticket.status, 'In Progress');
    assert.equal(r.body.ticket.sla_paused_at, null);
  });

  test('cannot resolve without resolution details and root cause; cannot close before resolution', async () => {
    const agent = await as('megha.arora@ozone.demo');
    let r = await agent.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'Resolved', resolution_summary: 'Fixed BOM' });
    assert.equal(r.status, 400);
    assert.ok(r.body.details.root_cause);
    r = await agent.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'Closed' });
    assert.equal(r.status, 403);
    r = await agent.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'Resolved', resolution_summary: 'BOM corrected to 12 sets', root_cause: 'Duplicate line in BOM template' });
    assert.equal(r.body.ticket.status, 'Resolved');
    assert.ok(r.body.ticket.resolved_at);
  });

  test('requester rejects resolution (reopen) with reason, then confirms closure', async () => {
    const req = await as('nikhil.jain@ozone.demo');
    let r = await req.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'In Progress' });
    assert.equal(r.status, 400, 'reason required');
    r = await req.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'In Progress', remarks: 'Still shows 14 on the PDF' });
    assert.equal(r.body.ticket.status, 'In Progress');
    assert.equal(r.body.ticket.reopen_count, 1);
    const agent = await as('megha.arora@ozone.demo');
    await agent.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'Resolved', resolution_summary: 'PDF template regenerated', root_cause: 'Cached PDF' });
    r = await req.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'Closed' });
    assert.equal(r.body.ticket.status, 'Closed');
    const hist = r.body.status_history.map((h) => h.to_status);
    assert.deepEqual(hist, ['New', 'Assigned', 'Awaiting Information', 'In Progress', 'Resolved', 'In Progress', 'Resolved', 'Closed']);
    assert.ok(r.body.status_history.every((h) => h.created_at && h.user_name));
  });

  test('closure-approval categories can only be closed by the department head', async () => {
    const s = (await create('sameer@urbanwindows.demo', { subject: 'Handle broke after a week', description: 'Handle came off a casement window.', category_id: ids('Service'), customer_name: 'Sunrise Heights Society', project_location: 'Sector 150, Noida' })).body;
    const agent = await as('tarun.gill@ozone.demo');
    await agent.post(`/api/tickets/${s.id}/status`).set(H).send({ status: 'Resolved', resolution_summary: 'Handle replaced', root_cause: 'Defective handle batch' });
    assert.equal((await (await as('sameer@urbanwindows.demo')).post(`/api/tickets/${s.id}/status`).set(H).send({ status: 'Closed' })).status, 403);
    assert.equal((await agent.post(`/api/tickets/${s.id}/status`).set(H).send({ status: 'Closed' })).status, 403);
    const r = await (await as('anjali.mishra@ozone.demo')).post(`/api/tickets/${s.id}/status`).set(H).send({ status: 'Closed', remarks: 'Approved' });
    assert.equal(r.body.ticket.status, 'Closed');
  });
});

describe('assignment and transfer', () => {
  let t;
  before(async () => {
    t = (await create('arjun.bhatia@ozone.demo', { subject: 'Survey dimensions look wrong', description: 'Opening W3 measured 100 mm short.', category_id: ids('Survey'), customer_name: 'Test Customer', project_location: 'Gurugram' })).body;
  });

  test('head assigns within the department; cross-department assignment is refused', async () => {
    const head = await as('manoj.yadav@ozone.demo');
    const rahul = getDb().prepare("SELECT id FROM users WHERE email = 'rahul.saini@ozone.demo'").get().id;
    const ramesh = getDb().prepare("SELECT id FROM users WHERE email = 'ramesh.pal@ozone.demo'").get().id;
    assert.equal((await head.post(`/api/tickets/${t.id}/assign`).set(H).send({ user_id: ramesh })).status, 400);
    const r = await head.post(`/api/tickets/${t.id}/assign`).set(H).send({ user_id: rahul, reason: 'Area surveyor' });
    assert.equal(r.body.ticket.assigned_name, 'Rahul Saini');
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ticket_id = ? AND type = 'ticket_assigned'").get(rahul, t.id).n;
    assert.equal(n, 1, 'assignee notified');
  });

  test('transfer keeps ID, history and attachments; reason is required', async () => {
    const rahul = await as('rahul.saini@ozone.demo');
    await rahul.post(`/api/tickets/${t.id}/attachments`).set(H).attach('files', PNG, 'site.png');
    assert.equal((await rahul.post(`/api/tickets/${t.id}/transfer`).set(H).send({ department_id: dept('PROD') })).status, 400);
    const r = await rahul.post(`/api/tickets/${t.id}/transfer`).set(H).send({ department_id: dept('PROD'), reason: 'Frames must be re-fabricated' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ticket.ticket_no, t.ticket_no);
    assert.equal(r.body.ticket.department_id, dept('PROD'));
    assert.equal(r.body.transfers.length, 1);
    assert.equal(r.body.attachments.length, 1);
    assert.equal(r.body.permissions.canWork, false, 'previous department keeps read-only visibility');
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM tickets WHERE ticket_no = ?').get(t.ticket_no).n, 1, 'no duplicate');
    const prod = await as('ramesh.pal@ozone.demo');
    const s = await prod.post(`/api/tickets/${t.id}/status`).set(H).send({ status: 'In Progress' });
    assert.equal(s.body.ticket.assigned_name, 'Ramesh Pal', 'self-assigned on start');
  });
});

describe('attachments validation', () => {
  test('accepts allowed types and rejects disallowed or spoofed files', async () => {
    const ok = await create('nikhil.jain@ozone.demo', { subject: 'Screen error on quote page', description: 'See attached screenshot of the error.', category_id: ids('OzoneBlu / IT Support') }, [['error.png', PNG]]);
    assert.equal(ok.status, 201);
    const exe = await create('nikhil.jain@ozone.demo', { subject: 'Bad attachment test', description: 'Should be rejected by the server.', category_id: ids('OzoneBlu / IT Support') }, [['tool.exe', Buffer.from('MZ')]]);
    assert.equal(exe.status, 400);
    const fake = await create('nikhil.jain@ozone.demo', { subject: 'Spoofed attachment test', description: 'Text file pretending to be PNG.', category_id: ids('OzoneBlu / IT Support') }, [['fake.png', Buffer.from('not an image')]]);
    assert.equal(fake.status, 400);
    const count = getDb().prepare("SELECT COUNT(*) AS n FROM tickets WHERE subject IN ('Bad attachment test','Spoofed attachment test')").get().n;
    assert.equal(count, 0, 'failed uploads roll back the ticket');
  });
});

describe('dashboards, reports and administration', () => {
  test('dashboard totals reflect stored data', async () => {
    const admin = await as('admin@ozone.demo');
    const d = await admin.get('/api/dashboard?from=2000-01-01');
    const n = getDb().prepare('SELECT COUNT(*) AS n FROM tickets').get().n;
    assert.equal(d.body.summary.total, n);
    const closed = getDb().prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'Closed'").get().n;
    assert.equal(d.body.summary.closed, closed);
    assert.equal(d.body.byDepartment.reduce((s, x) => s + x.total, 0), n);
  });

  test('reports are restricted to managers/admins and scoped to the manager’s department', async () => {
    assert.equal((await (await as('nikhil.jain@ozone.demo')).get('/api/reports/department_performance')).status, 403);
    const r = await (await as('harpreet.singh@ozone.demo')).get('/api/reports/department_performance');
    assert.equal(r.status, 200);
    assert.ok(r.body.rows.length > 0 && r.body.rows.every((x) => x.Department === 'Production / Quality'), 'department head sees only own department');
    const csv = await (await as('admin@ozone.demo')).get('/api/reports/dealer_volume?format=csv');
    assert.match(csv.headers['content-type'], /text\/csv/);
    const xlsx = await (await as('admin@ozone.demo')).get('/api/tickets/export?format=xlsx');
    assert.match(xlsx.headers['content-type'], /spreadsheetml/);
  });

  test('admin-only configuration; categories can be added without code changes', async () => {
    assert.equal((await (await as('harpreet.singh@ozone.demo')).get('/api/admin/users')).status, 403);
    const admin = await as('admin@ozone.demo');
    const c = await admin.post('/api/admin/categories').set(H).send({ name: 'Quality Audit', department_id: dept('PROD'), required_fields: ['production_order_no'], visible_fields: ['production_order_no'] });
    assert.equal(c.status, 201);
    const meta = await (await as('nikhil.jain@ozone.demo')).get('/api/meta');
    assert.ok(meta.body.categories.some((x) => x.name === 'Quality Audit'));
    const audit = getDb().prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'admin.categories.create'").get().n;
    assert.equal(audit, 1);
    await admin.patch(`/api/admin/categories/${c.body.id}`).set(H).send({ is_active: false });
    const meta2 = await (await as('nikhil.jain@ozone.demo')).get('/api/meta');
    assert.ok(!meta2.body.categories.some((x) => x.name === 'Quality Audit'), 'disabled categories hidden from the form');
  });

  test('OzoneBlu CSV import feeds lookups, scoped by dealer', async () => {
    const admin = await as('admin@ozone.demo');
    const r = await admin.post('/api/admin/ozoneblu/import').set(H).send({ csv: 'quote_no,sales_order_no,customer_name,dealer_code,order_stage\nQT/IMP/0001,SO/IMP/0001,Imported Customer,DLR-URB,Production' });
    assert.equal(r.body.imported, 1);
    assert.equal((await (await as('sameer@urbanwindows.demo')).get('/api/ozoneblu/lookup?q=QT/IMP')).body.length, 1);
    assert.equal((await (await as('rakesh@skyline.demo')).get('/api/ozoneblu/lookup?q=QT/IMP')).body.length, 0);
  });
});
