// Seeds reference data (roles, departments, categories, SLA targets…) and a realistic demo dataset.
// Usage: npm run seed            (resets the database file and loads demo data)
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { getDb, open, setDb } = require('./index');
const { setClock } = require('../lib/util');
const svc = require('../lib/ticketService');
const { loadUser } = require('../lib/auth');

const DEMO_PASSWORD = 'Ozone@123';

const DEPARTMENTS = [
  ['TRIAGE', 'Central Triage / Helpdesk', { is_triage: 1 }],
  ['SALES', 'Sales Support'], ['DEALER', 'Dealer Support'], ['COST', 'Costing'], ['DESIGN', 'Design / Technical'],
  ['SURVEY', 'Survey'], ['COMM', 'Commercial'], ['PLAN', 'Planning'], ['PROD', 'Production / Quality'], ['DISP', 'Dispatch'],
  ['INST', 'Installation'], ['SERV', 'Service'], ['IT', 'IT / OzoneBlu Application Support'], ['MGMT', 'Management', { sees_all: 1 }],
];

const STAGES = ['Quotation', 'Design & Technical', 'Costing', 'Survey', 'Commercial Approval', 'Planning', 'Production', 'Dispatch', 'Installation', 'Service / After-sales'];

// [category, default dept, subcategories (name or [name, deptOverride]), visible fields, required fields, flags]
const CATEGORIES = [
  ['Sales', 'SALES', ['Quote creation issue', 'Incorrect customer or order details', 'Product selection issue', 'Pricing mismatch', 'Sales order conversion issue', 'Quote revision issue'],
    ['dealer_id', 'customer_name', 'project_location', 'quote_no', 'sales_order_no', 'order_stage', 'customer_impact', 'expected_resolution_date', 'related_ticket_no'], ['quote_no']],
  ['Dealer', 'DEALER', ['Dealer portal access', 'Order entry issue', ['Product selection assistance', 'SALES'], 'Order status query', 'Documentation issue'],
    ['dealer_id', 'customer_name', 'project_location', 'quote_no', 'sales_order_no', 'order_stage', 'customer_impact', 'related_ticket_no'], ['dealer_id']],
  ['Costing', 'COST', ['Costing validation pending', 'Incorrect costing', 'Price or margin mismatch', 'BOM or quantity mismatch', 'Costing approval issue'],
    ['dealer_id', 'customer_name', 'quote_no', 'sales_order_no', 'order_stage', 'customer_impact', 'expected_resolution_date', 'related_ticket_no'], ['quote_no']],
  ['Design / Technical', 'DESIGN', ['Door or window design selection', 'Incorrect dimensions', 'Configuration mismatch', 'Drawing or technical specification issue', 'Glass, hardware, profile or accessory selection', 'Drawing approval issue'],
    ['dealer_id', 'customer_name', 'project_location', 'quote_no', 'sales_order_no', 'order_stage', 'customer_impact', 'related_ticket_no'], ['quote_no']],
  ['Survey', 'SURVEY', ['Survey assignment pending', 'Survey scheduling', 'Incorrect site measurements', 'Site condition mismatch', 'Survey report pending', 'Resurvey requirement'],
    ['dealer_id', 'customer_name', 'project_location', 'quote_no', 'sales_order_no', 'survey_ref', 'order_stage', 'customer_impact', 'expected_resolution_date', 'related_ticket_no'], ['customer_name', 'project_location']],
  ['Commercial', 'COMM', ['Advance or payment issue', 'Credit or outstanding issue', 'Commercial approval pending', 'Billing or invoice issue', 'Order release issue'],
    ['dealer_id', 'customer_name', 'quote_no', 'sales_order_no', 'order_stage', 'customer_impact', 'related_ticket_no'], ['sales_order_no'], { requires_closure_approval: 1 }],
  ['Planning', 'PLAN', ['Production planning delay', 'Material availability issue', 'Incorrect production schedule', 'Order prioritization issue', 'Dependency on another department'],
    ['dealer_id', 'customer_name', 'sales_order_no', 'production_order_no', 'order_stage', 'customer_impact', 'expected_resolution_date', 'related_ticket_no'], ['sales_order_no']],
  ['Production', 'PROD', ['Production not started', 'Manufacturing delay', 'Wrong dimensions or configuration', 'Material or component shortage', 'Quality issue', 'Rework requirement', 'Production completion update'],
    ['dealer_id', 'customer_name', 'sales_order_no', 'production_order_no', 'order_stage', 'customer_impact', 'expected_resolution_date', 'related_ticket_no'], ['production_order_no']],
  ['Dispatch', 'DISP', ['Dispatch planning delay', 'Packing issue', 'Dispatch documentation', 'Vehicle or transport issue', 'Material shortage', 'Dispatch status mismatch'],
    ['dealer_id', 'customer_name', 'project_location', 'sales_order_no', 'production_order_no', 'order_stage', 'customer_impact', 'expected_resolution_date', 'related_ticket_no'], ['sales_order_no']],
  ['Installation', 'INST', ['Installation scheduling', 'Installation team allocation', 'Site readiness issue', 'Installation delay', 'Incorrect or missing material', 'Installation quality issue'],
    ['dealer_id', 'customer_name', 'project_location', 'sales_order_no', 'order_stage', 'customer_impact', 'expected_resolution_date', 'related_ticket_no'], ['sales_order_no', 'customer_name', 'project_location']],
  ['Service', 'SERV', ['Customer complaint', 'Product defect', 'Hardware or accessory issue', 'Repair or replacement request', 'Post-installation complaint', 'Warranty-related issue'],
    ['dealer_id', 'customer_name', 'project_location', 'sales_order_no', 'order_stage', 'customer_impact', 'expected_resolution_date', 'related_ticket_no'], ['customer_name', 'project_location'], { requires_closure_approval: 1 }],
  ['OzoneBlu / IT Support', 'IT', ['Login or access issue', 'Quote creation error', 'Software malfunction', 'Page not loading', 'Data mismatch', 'Workflow or approval issue', 'Integration issue', 'Performance problem'],
    ['quote_no', 'sales_order_no', 'order_stage', 'customer_impact', 'related_ticket_no'], [], { is_software: 1 }],
  ['Other / Not sure', null, ['General query', 'Not sure which team'], ['dealer_id', 'customer_name', 'quote_no', 'sales_order_no', 'order_stage', 'customer_impact', 'related_ticket_no'], []],
];

// SUGGESTED, CONFIGURABLE targets — pending approval by Ozone management (not existing Ozone policy).
// Minutes are business minutes (09:30–18:30, Mon–Sat ⇒ 1 business day = 540 min).
const SLA = [
  ['Critical — suggested target', 'Critical', 60, 540],
  ['High — suggested target', 'High', 240, 1620],
  ['Medium — suggested target', 'Medium', 540, 2700],
  ['Low — suggested target', 'Low', 1080, 5400],
];

const NOTIFY_EVENTS = ['ticket_created', 'ticket_assigned', 'ticket_reassigned', 'status_changed', 'info_requested', 'comment_added', 'ticket_escalated', 'sla_warning', 'sla_breached', 'ticket_resolved', 'ticket_closed', 'ticket_reopened'];

const DEALERS = [
  ['DLR-SKY', 'Skyline Fenestration', 'Gurugram', 'Rakesh Arora', '+91 98110 00001'],
  ['DLR-URB', 'Urban Windows & Doors', 'Noida', 'Sameer Khan', '+91 98110 00002'],
  ['DLR-PRM', 'Prime Glazing Solutions', 'Jaipur', 'Lokesh Sharma', '+91 98110 00003'],
  ['DLR-VST', 'Vista Interiors', 'Chandigarh', 'Jaspreet Kaur', '+91 98110 00004'],
  ['DLR-CST', 'Coastal Facades', 'Mumbai', 'Farhan Shaikh', '+91 98110 00005'],
  ['DLR-HRT', 'Heritage Home Solutions', 'Lucknow', 'Abhishek Srivastava', '+91 98110 00006'],
];

const CUSTOMERS = [
  ['Mr. Vivek Malhotra (Villa 14)', 'DLF Phase 5, Gurugram', 'DLR-SKY'],
  ['Greenwood Residency (Tower B)', 'Sector 89, Gurugram', 'DLR-SKY'],
  ['Mrs. Kavya Menon', 'Golf Course Road, Gurugram', 'DLR-SKY'],
  ['Sunrise Heights Society', 'Sector 150, Noida', 'DLR-URB'],
  ['Dr. Anil Batra Clinic', 'Sector 18, Noida', 'DLR-URB'],
  ['Mr. Harish Goyal (Farmhouse)', 'Vaishali Nagar, Jaipur', 'DLR-PRM'],
  ['Rajputana Boutique Hotel', 'C-Scheme, Jaipur', 'DLR-PRM'],
  ['Mrs. Simran Gill', 'Sector 8, Chandigarh', 'DLR-VST'],
  ['Elante Office Suites', 'Industrial Area Phase 1, Chandigarh', 'DLR-VST'],
  ['Seaview Apartments', 'Bandra West, Mumbai', 'DLR-CST'],
  ['Gomti Greens Villas', 'Gomti Nagar, Lucknow', 'DLR-HRT'],
  ['Aravalli Corporate Park', 'Sohna Road, Gurugram', null],
  ['Mr. Sandeep Khurana', 'Vasant Vihar, New Delhi', null],
  ['Orchid Petals Clubhouse', 'Sector 49, Gurugram', null],
];

// key, name, email, role, dept code, dealer code, designation
const USERS = [
  ['admin', 'System Administrator', 'admin@ozone.demo', 'admin', 'IT', null, 'IT Administrator'],
  ['alok', 'Alok Mehra', 'alok.mehra@ozone.demo', 'manager', 'MGMT', null, 'Director – Operations'],
  ['neha', 'Neha Kapoor', 'neha.kapoor@ozone.demo', 'manager', 'TRIAGE', null, 'Helpdesk Lead'],
  ['pooja', 'Pooja Sharma', 'pooja.sharma@ozone.demo', 'agent', 'TRIAGE', null, 'Helpdesk Executive'],
  ['rajiv', 'Rajiv Malhotra', 'rajiv.malhotra@ozone.demo', 'manager', 'SALES', null, 'Head – Sales Support'],
  ['ankit', 'Ankit Verma', 'ankit.verma@ozone.demo', 'agent', 'SALES', null, 'Sales Coordinator'],
  ['simran', 'Simran Kaur', 'simran.kaur@ozone.demo', 'agent', 'SALES', null, 'Sales Coordinator'],
  ['vikas', 'Vikas Chauhan', 'vikas.chauhan@ozone.demo', 'manager', 'DEALER', null, 'Head – Dealer Network'],
  ['ritika', 'Ritika Joshi', 'ritika.joshi@ozone.demo', 'agent', 'DEALER', null, 'Dealer Support Executive'],
  ['sanjay', 'Sanjay Gupta', 'sanjay.gupta@ozone.demo', 'manager', 'COST', null, 'Head – Costing'],
  ['megha', 'Megha Arora', 'megha.arora@ozone.demo', 'agent', 'COST', null, 'Costing Engineer'],
  ['deepak', 'Deepak Rawat', 'deepak.rawat@ozone.demo', 'agent', 'COST', null, 'Costing Engineer'],
  ['arvind', 'Arvind Iyer', 'arvind.iyer@ozone.demo', 'manager', 'DESIGN', null, 'Head – Design & Technical'],
  ['karan', 'Karan Mehta', 'karan.mehta@ozone.demo', 'agent', 'DESIGN', null, 'Design Engineer'],
  ['shruti', 'Shruti Nair', 'shruti.nair@ozone.demo', 'agent', 'DESIGN', null, 'Technical Engineer'],
  ['manoj', 'Manoj Yadav', 'manoj.yadav@ozone.demo', 'manager', 'SURVEY', null, 'Survey Manager'],
  ['rahul', 'Rahul Saini', 'rahul.saini@ozone.demo', 'agent', 'SURVEY', null, 'Site Surveyor'],
  ['imran', 'Imran Khan', 'imran.khan@ozone.demo', 'agent', 'SURVEY', null, 'Site Surveyor'],
  ['priya', 'Priya Bansal', 'priya.bansal@ozone.demo', 'manager', 'COMM', null, 'Commercial Manager'],
  ['nitin', 'Nitin Aggarwal', 'nitin.aggarwal@ozone.demo', 'agent', 'COMM', null, 'Commercial Executive'],
  ['suresh', 'Suresh Kumar', 'suresh.kumar@ozone.demo', 'manager', 'PLAN', null, 'Planning Manager'],
  ['kavita', 'Kavita Rao', 'kavita.rao@ozone.demo', 'agent', 'PLAN', null, 'Planning Executive'],
  ['harpreet', 'Harpreet Singh', 'harpreet.singh@ozone.demo', 'manager', 'PROD', null, 'Plant Head – Production & QA'],
  ['ramesh', 'Ramesh Pal', 'ramesh.pal@ozone.demo', 'agent', 'PROD', null, 'Production Supervisor'],
  ['amit', 'Amit Tiwari', 'amit.tiwari@ozone.demo', 'agent', 'PROD', null, 'QA Engineer'],
  ['gaurav', 'Gaurav Sethi', 'gaurav.sethi@ozone.demo', 'manager', 'DISP', null, 'Dispatch Manager'],
  ['mohit', 'Mohit Sharma', 'mohit.sharma@ozone.demo', 'agent', 'DISP', null, 'Dispatch Coordinator'],
  ['rakeshc', 'Rakesh Chauhan', 'rakesh.chauhan@ozone.demo', 'manager', 'INST', null, 'Installation Manager'],
  ['sunil', 'Sunil Bhatt', 'sunil.bhatt@ozone.demo', 'agent', 'INST', null, 'Installation Supervisor'],
  ['vinod', 'Vinod Kumar', 'vinod.kumar@ozone.demo', 'agent', 'INST', null, 'Installation Supervisor'],
  ['anjali', 'Anjali Mishra', 'anjali.mishra@ozone.demo', 'manager', 'SERV', null, 'Service Manager'],
  ['tarun', 'Tarun Gill', 'tarun.gill@ozone.demo', 'agent', 'SERV', null, 'Service Engineer'],
  ['rohit', 'Rohit Saxena', 'rohit.saxena@ozone.demo', 'manager', 'IT', null, 'IT Manager – OzoneBlu'],
  ['ayesha', 'Ayesha Siddiqui', 'ayesha.siddiqui@ozone.demo', 'agent', 'IT', null, 'Application Support Engineer'],
  ['varun', 'Varun Khanna', 'varun.khanna@ozone.demo', 'agent', 'IT', null, 'Application Support Engineer'],
  ['nikhil', 'Nikhil Jain', 'nikhil.jain@ozone.demo', 'creator', 'SALES', null, 'Sales Executive – Gurugram'],
  ['sneha', 'Sneha Reddy', 'sneha.reddy@ozone.demo', 'creator', 'SALES', null, 'Sales Executive – Delhi'],
  ['arjun', 'Arjun Bhatia', 'arjun.bhatia@ozone.demo', 'creator', 'PLAN', null, 'Project Coordinator'],
  ['rakesha', 'Rakesh Arora', 'rakesh@skyline.demo', 'dealer', null, 'DLR-SKY', 'Owner, Skyline Fenestration'],
  ['divya', 'Divya Arora', 'divya@skyline.demo', 'dealer', null, 'DLR-SKY', 'Operations, Skyline Fenestration'],
  ['sameer', 'Sameer Khan', 'sameer@urbanwindows.demo', 'dealer', null, 'DLR-URB', 'Owner, Urban Windows & Doors'],
  ['lokesh', 'Lokesh Sharma', 'lokesh@primeglazing.demo', 'dealer', null, 'DLR-PRM', 'Owner, Prime Glazing Solutions'],
  ['jaspreet', 'Jaspreet Kaur', 'jaspreet@vista.demo', 'dealer', null, 'DLR-VST', 'Owner, Vista Interiors'],
];

function seedReference(db) {
  const ins = (sql, ...a) => db.prepare(sql).run(...a).lastInsertRowid;
  [['creator', 'Employee / Ticket Creator'], ['dealer', 'Dealer'], ['agent', 'Department / Support Team'], ['manager', 'Department Head / Manager'], ['admin', 'System Administrator']]
    .forEach(([c, n]) => ins('INSERT INTO roles (code, name) VALUES (?,?)', c, n));
  DEPARTMENTS.forEach(([code, name, f = {}], i) => ins('INSERT INTO departments (code, name, is_triage, sees_all, sort_order) VALUES (?,?,?,?,?)', code, name, f.is_triage || 0, f.sees_all || 0, i));
  STAGES.forEach((s, i) => ins('INSERT INTO order_stages (code, name, sort_order) VALUES (?,?,?)', s.toUpperCase().replace(/[^A-Z]+/g, '_'), s, i));
  const dept = (c) => (c ? db.prepare('SELECT id FROM departments WHERE code = ?').get(c).id : null);
  CATEGORIES.forEach(([name, d, subs, vis, req, f = {}], i) => {
    const cid = ins('INSERT INTO ticket_categories (name, department_id, is_software, requires_closure_approval, visible_fields, required_fields, sort_order) VALUES (?,?,?,?,?,?,?)',
      name, dept(d), f.is_software || 0, f.requires_closure_approval || 0, JSON.stringify(vis), JSON.stringify(req), i);
    subs.forEach((s, j) => {
      const [sn, sd] = Array.isArray(s) ? s : [s, null];
      ins('INSERT INTO ticket_subcategories (category_id, name, department_id, sort_order) VALUES (?,?,?,?)', cid, sn, dept(sd), j);
    });
  });
  const sub = (cat, name) => db.prepare('SELECT s.id, s.category_id FROM ticket_subcategories s JOIN ticket_categories c ON c.id = s.category_id WHERE c.name = ? AND s.name = ?').get(cat, name);
  const pm = sub('Sales', 'Pricing mismatch');
  ins('INSERT INTO routing_rules (name, category_id, subcategory_id, department_id, rank) VALUES (?,?,?,?,?)', 'Pricing mismatches are validated by Costing', pm.category_id, pm.id, dept('COST'), 10);
  const dealerCat = db.prepare("SELECT id FROM ticket_categories WHERE name = 'Dealer'").get().id;
  ins('INSERT INTO routing_rules (name, category_id, order_stage, department_id, rank) VALUES (?,?,?,?,?)', 'Dealer issues at installation stage go to Installation', dealerCat, 'Installation', dept('INST'), 20);
  SLA.forEach(([n, p, fr, res]) => ins('INSERT INTO sla_policies (name, priority, first_response_minutes, resolution_minutes) VALUES (?,?,?,?)', n, p, fr, res));
  [['Warn assignee at 80% of resolution target', 'warning', 0, null, 'agent', 1], ['Notify department head on SLA breach', 'resolution_breach', 0, null, 'manager', 1],
    ['Escalate to management 1 business day after breach', 'resolution_breach', 540, null, 'admin', 2], ['Critical: notify head on first-response breach', 'first_response_breach', 0, 'Critical', 'manager', 1]]
    .forEach(([n, t, m, p, role, lvl]) => ins('INSERT INTO escalation_rules (name, trigger_type, minutes_after, priority, notify_role, level) VALUES (?,?,?,?,?,?)', n, t, m, p, role, lvl));
  NOTIFY_EVENTS.forEach((e) => ins('INSERT INTO notification_settings (event_type, in_app, email) VALUES (?,1,0)', e));
  [['2026-01-26', 'Republic Day'], ['2026-03-04', 'Holi'], ['2026-08-15', 'Independence Day'], ['2026-10-02', 'Gandhi Jayanti'], ['2026-10-20', 'Dussehra'], ['2026-11-09', 'Diwali (verify date)']]
    .forEach(([d, n]) => ins('INSERT INTO holidays (date, name) VALUES (?,?)', d, n));
}

function seedPeople(db) {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const now = new Date().toISOString();
  DEALERS.forEach(([code, name, city, contact, phone]) => db.prepare('INSERT INTO dealers (code, name, city, contact_person, phone) VALUES (?,?,?,?,?)').run(code, name, city, contact, phone));
  const dealerId = (c) => (c ? db.prepare('SELECT id FROM dealers WHERE code = ?').get(c).id : null);
  CUSTOMERS.forEach(([n, loc, d]) => db.prepare('INSERT INTO customers (name, location, dealer_id) VALUES (?,?,?)').run(n, loc, dealerId(d)));
  const ids = {};
  for (const [key, name, email, role, dept, dealer, desig] of USERS) {
    const roleId = db.prepare('SELECT id FROM roles WHERE code = ?').get(role).id;
    const deptId = dept ? db.prepare('SELECT id FROM departments WHERE code = ?').get(dept).id : null;
    ids[key] = Number(db.prepare('INSERT INTO users (name, email, password_hash, role_id, department_id, dealer_id, designation, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(name, email, hash, roleId, deptId, dealerId(dealer), desig, now, now).lastInsertRowid);
  }
  // Department heads
  for (const [key, , , role, dept] of USERS) if (role === 'manager') db.prepare('UPDATE departments SET head_user_id = ? WHERE code = ?').run(ids[key], dept);
  // OzoneBlu reference data (as if imported from an approved CSV export)
  const refs = [
    ['QT/GGN/26-27/0412', 'SO/26-27/1187', 'Mr. Vivek Malhotra (Villa 14)', 'DLR-SKY', 'DLF Phase 5, Gurugram', 'Production'],
    ['QT/GGN/26-27/0455', 'SO/26-27/1203', 'Greenwood Residency (Tower B)', 'DLR-SKY', 'Sector 89, Gurugram', 'Dispatch'],
    ['QT/GGN/26-27/0518', null, 'Mrs. Kavya Menon', 'DLR-SKY', 'Golf Course Road, Gurugram', 'Costing'],
    ['QT/NDA/26-27/0230', 'SO/26-27/1165', 'Sunrise Heights Society', 'DLR-URB', 'Sector 150, Noida', 'Installation'],
    ['QT/NDA/26-27/0261', null, 'Dr. Anil Batra Clinic', 'DLR-URB', 'Sector 18, Noida', 'Survey'],
    ['QT/JPR/26-27/0144', 'SO/26-27/1122', 'Mr. Harish Goyal (Farmhouse)', 'DLR-PRM', 'Vaishali Nagar, Jaipur', 'Installation'],
    ['QT/JPR/26-27/0160', 'SO/26-27/1240', 'Rajputana Boutique Hotel', 'DLR-PRM', 'C-Scheme, Jaipur', 'Planning'],
    ['QT/CHD/26-27/0098', 'SO/26-27/1215', 'Elante Office Suites', 'DLR-VST', 'Industrial Area Phase 1, Chandigarh', 'Commercial Approval'],
    ['QT/GGN/26-27/0390', 'SO/26-27/1098', 'Aravalli Corporate Park', null, 'Sohna Road, Gurugram', 'Service / After-sales'],
    ['QT/DEL/26-27/0301', 'SO/26-27/1176', 'Mr. Sandeep Khurana', null, 'Vasant Vihar, New Delhi', 'Production'],
    ['QT/GGN/26-27/0533', null, 'Orchid Petals Clubhouse', null, 'Sector 49, Gurugram', 'Quotation'],
  ];
  refs.forEach((r) => db.prepare('INSERT INTO ozoneblu_references (quote_no, sales_order_no, customer_name, dealer_code, project_location, order_stage, imported_by, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(...r, ids.admin, now));
  return ids;
}

// ---------- demo tickets: realistic scenarios replayed through the real service layer ----------
const A = (h, who, to, reason) => ({ h, who, act: 'assign', to, reason });
const S = (h, who, status, remarks) => ({ h, who, act: 'status', status, remarks });
const C = (h, who, body) => ({ h, who, act: 'comment', body });
const N = (h, who, body) => ({ h, who, act: 'note', body });
const T = (h, who, dept, reason) => ({ h, who, act: 'transfer', dept, reason });
const R = (h, who, resolution_summary, root_cause, corrective_action) => ({ h, who, act: 'status', status: 'Resolved', resolution_summary, root_cause, corrective_action });
const CL = (h, who, remarks = 'Confirmed resolved') => ({ h, who, act: 'status', status: 'Closed', remarks });

const SCENARIOS = [
  { by: 'nikhil', d: 74, cat: 'Sales', sub: 'Quote creation issue', p: 'High', subject: 'Unable to add sliding door series to quote for Villa 14',
    desc: 'While creating the quote in OzoneBlu for DLF Phase 5 villa, the lift & slide series does not appear in the product list. Customer meeting is tomorrow.',
    f: { dealer: 'DLR-SKY', customer: 'Mr. Vivek Malhotra (Villa 14)', quote_no: 'QT/GGN/26-27/0412', order_stage: 'Quotation', customer_impact: 'Customer presentation scheduled for tomorrow' },
    steps: [A(1, 'rajiv', 'ankit'), S(2, 'ankit', 'In Progress'), C(3, 'ankit', 'The series is restricted to approved dealers. Enabling it for Skyline now.'), R(5, 'ankit', 'Enabled the lift & slide series for Skyline dealer price list; quote re-created successfully.', 'Product series not mapped to dealer price list', 'Added check to dealer onboarding checklist'), CL(20, 'nikhil')] },
  { by: 'rakesha', d: 70, cat: 'Dealer', sub: 'Dealer portal access', p: 'Medium', subject: 'New staff member cannot log in to dealer portal',
    desc: 'Our new coordinator Divya has been given credentials but gets "account not active" on login.', f: { order_stage: 'Quotation' },
    steps: [S(3, 'ritika', 'In Progress'), C(4, 'ritika', 'Activated the account and shared a password-reset link.'), R(6, 'ritika', 'Account activated and reset link sent.', 'Account created but activation step missed', 'Activation added to the user-creation SOP'), CL(30, 'rakesha')] },
  { by: 'sneha', d: 66, cat: 'Sales', sub: 'Pricing mismatch', p: 'High', subject: 'Price in quote differs from approved price list for Khurana project',
    desc: 'Quote QT/DEL/26-27/0301 shows ₹2,140/sqft for the casement series whereas the approved list for this quarter is ₹1,985/sqft.',
    f: { customer: 'Mr. Sandeep Khurana', quote_no: 'QT/DEL/26-27/0301', sales_order_no: 'SO/26-27/1176', order_stage: 'Costing', customer_impact: 'Customer has questioned the price; order on hold' },
    steps: [A(2, 'sanjay', 'megha'), S(3, 'megha', 'In Progress'), N(5, 'megha', 'Old Q1 price list still active in OzoneBlu for Delhi region. Raised with IT.'), R(28, 'megha', 'Corrected the price list version for Delhi region; quote revised to ₹1,985/sqft.', 'Outdated price list version active for one region', 'IT to deactivate superseded price lists on quarter change'), CL(40, 'sneha')] },
  { by: 'arjun', d: 61, cat: 'Survey', sub: 'Incorrect site measurements', p: 'Critical', subject: 'Window W7 opening measured 150 mm short — Greenwood Tower B',
    desc: 'Fabricated frames for W7 (12 units) do not fit. Site opening is 1,650 mm; survey sheet says 1,500 mm.',
    f: { dealer: 'DLR-SKY', customer: 'Greenwood Residency (Tower B)', sales_order_no: 'SO/26-27/1203', survey_ref: 'SV-26-0218', order_stage: 'Installation', customer_impact: '12 windows cannot be installed; installation team idle' },
    steps: [A(0.5, 'manoj', 'rahul'), S(1, 'rahul', 'In Progress'), C(4, 'rahul', 'Resurvey completed. Confirmed 1,650 mm for all W7 openings. Survey sheet transcription error.'), T(5, 'rahul', 'PROD', 'Frames must be re-fabricated to corrected dimensions'), A(6, 'harpreet', 'ramesh'), S(7, 'ramesh', 'In Progress'), R(72, 'ramesh', 'Re-fabricated 12 frames at corrected size and dispatched.', 'Survey sheet transcription error (1650 recorded as 1500)', 'Digital survey form with range validation to be introduced'), CL(96, 'arjun')] },
  { by: 'nikhil', d: 58, cat: 'OzoneBlu / IT Support', sub: 'Page not loading', p: 'Critical', subject: 'OzoneBlu quote page times out for all Gurugram users',
    desc: 'Since 10:15 AM the quote creation page shows a spinner and then a 504 error. Affects the whole Gurugram sales team.', f: { customer_impact: 'No quotes can be issued' },
    steps: [A(0.2, 'rohit', 'varun'), S(0.3, 'varun', 'In Progress'), N(1, 'varun', 'DB connection pool exhausted after nightly report job overran.'), R(2, 'varun', 'Restarted app pool and rescheduled the report job to 2 AM.', 'Long-running report job exhausted DB connections', 'Report job moved off business hours; connection pool alerting added'), CL(6, 'nikhil')] },
  { by: 'sameer', d: 55, cat: 'Installation', sub: 'Installation delay', p: 'High', subject: 'Installation at Sunrise Heights delayed by 9 days',
    desc: 'Material reached site on the 3rd, but installation team has not started. Society committee is escalating.',
    f: { customer: 'Sunrise Heights Society', sales_order_no: 'SO/26-27/1165', order_stage: 'Installation', customer_impact: 'Society committee complaint; penalty clause risk' },
    steps: [A(2, 'rakeshc', 'sunil'), S(3, 'sunil', 'In Progress'), S(30, 'rakeshc', 'Escalated', 'Team shortage in Noida region; requesting contractor team approval'), N(31, 'alok', 'Approved additional contractor team for two weeks.'), S(33, 'sunil', 'In Progress'), R(120, 'sunil', 'Installation completed with contractor support.', 'Installer capacity shortfall in Noida', 'Regional capacity plan reviewed weekly'), CL(140, 'rakeshc')] },
  { by: 'arjun', d: 52, cat: 'Production', sub: 'Quality issue', p: 'High', subject: 'Scratches on powder-coated profiles — batch WO-26-0934',
    desc: 'QC found visible scratches on 18 profiles (RAL 7016) during final inspection.', f: { sales_order_no: 'SO/26-27/1187', production_order_no: 'WO-26-0934', order_stage: 'Production', customer: 'Mr. Vivek Malhotra (Villa 14)' },
    steps: [A(1, 'harpreet', 'amit'), S(2, 'amit', 'In Progress'), N(6, 'amit', 'Root cause: protective film not applied after coating on Line 2.'), R(30, 'amit', 'Affected profiles re-coated and packed with protective film.', 'Protective film step skipped on Line 2', 'Film application added as QC hold point'), CL(50, 'harpreet')] },
  { by: 'lokesh', d: 49, cat: 'Commercial', sub: 'Advance or payment issue', p: 'Medium', subject: 'Advance payment not reflecting against SO/26-27/1122',
    desc: 'We transferred ₹4,50,000 via RTGS on the 12th (UTR ending 8812) but the order still shows advance pending.',
    f: { customer: 'Mr. Harish Goyal (Farmhouse)', sales_order_no: 'SO/26-27/1122', order_stage: 'Commercial Approval' },
    steps: [A(3, 'priya', 'nitin'), S(4, 'nitin', 'Awaiting Information', 'Please share the RTGS confirmation / bank advice.'), C(20, 'lokesh', 'Bank advice attached. UTR SBIN26128812.'), R(28, 'nitin', 'Payment located in suspense account and mapped to SO/26-27/1122.', 'Remitter name mismatch kept receipt in suspense', 'Dealers to quote SO number in remittance remarks'), CL(36, 'priya')] },
  { by: 'sneha', d: 46, cat: 'Design / Technical', sub: 'Glass, hardware, profile or accessory selection', p: 'Medium', subject: 'Need acoustic glass option for Vasant Vihar bedroom windows',
    desc: 'Customer wants 40 dB reduction. Please advise suitable DGU configuration and hardware.', f: { customer: 'Mr. Sandeep Khurana', quote_no: 'QT/DEL/26-27/0301', order_stage: 'Design & Technical' },
    steps: [A(4, 'arvind', 'shruti'), S(5, 'shruti', 'In Progress'), C(9, 'shruti', 'Recommend 6 mm + 12 mm + 6.38 mm laminated acoustic DGU with multipoint locking.'), R(10, 'shruti', 'Configuration shared and added to quote.', 'Customer requirement – no defect', ''), CL(30, 'sneha')] },
  { by: 'nikhil', d: 43, cat: 'Costing', sub: 'Costing validation pending', p: 'High', subject: 'Costing validation pending for 4 days — Kavya Menon quote',
    desc: 'Quote QT/GGN/26-27/0518 submitted for costing validation on Monday. Customer wants final price.', f: { dealer: 'DLR-SKY', customer: 'Mrs. Kavya Menon', quote_no: 'QT/GGN/26-27/0518', order_stage: 'Costing' },
    steps: [A(2, 'sanjay', 'deepak'), S(3, 'deepak', 'In Progress'), R(8, 'deepak', 'Costing validated and approved.', 'Validation queue backlog', 'Daily costing queue review introduced'), S(30, 'nikhil', 'In Progress', 'Approved costing excludes the motorised blinds line item — please revalidate.'), R(34, 'deepak', 'Revalidated including motorised blinds.', 'Line item missed during validation', 'Checklist to reconcile line count before approval'), CL(40, 'nikhil')] },
  { by: 'divya', d: 40, cat: 'Dispatch', sub: 'Dispatch status mismatch', p: 'Medium', subject: 'Portal shows dispatched but material not received — SO/26-27/1203',
    desc: 'Status updated to dispatched 3 days ago, but transporter says the vehicle has not left the plant.', f: { customer: 'Greenwood Residency (Tower B)', sales_order_no: 'SO/26-27/1203', order_stage: 'Dispatch' },
    steps: [A(3, 'gaurav', 'mohit'), S(4, 'mohit', 'In Progress'), C(6, 'mohit', 'Vehicle was rescheduled; status was marked early. Vehicle leaves today, LR to follow.'), R(30, 'mohit', 'Material dispatched; LR number shared.', 'Status updated before gate-out', 'Dispatch status now updated only at gate-out'), CL(60, 'divya')] },
  { by: 'arjun', d: 37, cat: 'Planning', sub: 'Material availability issue', p: 'High', subject: 'Multipoint locks out of stock — 3 orders blocked',
    desc: 'Planning cannot release WO for SO/26-27/1240 and two others due to shortage of multipoint lock sets (Ozone MPL-85).', f: { sales_order_no: 'SO/26-27/1240', order_stage: 'Planning', customer: 'Rajputana Boutique Hotel', customer_impact: 'Three orders delayed ~2 weeks' },
    steps: [A(2, 'suresh', 'kavita'), S(3, 'kavita', 'On Hold', 'Waiting for purchase to confirm PO delivery date for MPL-85'), S(100, 'kavita', 'In Progress'), R(140, 'kavita', 'Stock received; work orders released.', 'Reorder level for MPL-85 set too low', 'Reorder level increased; weekly shortage report to planning')] },
  { by: 'jaspreet', d: 33, cat: 'Commercial', sub: 'Commercial approval pending', p: 'High', subject: 'Commercial approval pending for Elante Office Suites order',
    desc: 'Order SO/26-27/1215 waiting for commercial approval for 6 days. Credit limit was already enhanced last month.', f: { customer: 'Elante Office Suites', sales_order_no: 'SO/26-27/1215', order_stage: 'Commercial Approval', customer_impact: 'Customer fit-out schedule at risk' },
    steps: [A(5, 'priya', 'nitin'), S(6, 'nitin', 'In Progress'), N(8, 'nitin', 'Credit enhancement letter not uploaded in OzoneBlu. Following up with accounts.'), S(60, 'nitin', 'Escalated', 'Accounts yet to update credit limit; needs Commercial Manager sign-off')] },
  { by: 'pooja', d: 30, cat: 'Other / Not sure', sub: 'Not sure which team', p: 'Medium', subject: 'Customer asking for maintenance kit for old installation',
    desc: 'Customer installed Ozone windows in 2021 and wants a lubrication/maintenance kit. Not sure who handles spares sales.', f: { customer: 'Mr. Sandeep Khurana' },
    steps: [A(1, 'neha', 'pooja'), T(2, 'pooja', 'SERV', 'Spares and maintenance kits are handled by Service'), A(4, 'anjali', 'tarun'), S(5, 'tarun', 'In Progress'), R(30, 'tarun', 'Maintenance kit quoted and shared with customer.', 'Customer request – spares', ''), CL(48, 'anjali')] },
  { by: 'sameer', d: 27, cat: 'Service', sub: 'Hardware or accessory issue', p: 'Medium', subject: 'Handle loose on 4 casement windows — Dr. Batra Clinic',
    desc: 'Handles on four casement windows have become loose within 2 months of installation.', f: { customer: 'Dr. Anil Batra Clinic', project_location: 'Sector 18, Noida', order_stage: 'Service / After-sales' },
    steps: [A(4, 'anjali', 'tarun'), S(5, 'tarun', 'In Progress'), C(30, 'tarun', 'Site visit done. Fixing screws were short; replaced with correct length.'), R(31, 'tarun', 'Handles refixed with correct screws.', 'Wrong screw length supplied in accessory kit', 'Accessory kit BOM corrected'), S(80, 'sameer', 'In Progress', 'One handle is loose again.'), N(82, 'tarun', 'Reopened — check gearbox, not just screws.')] },
  { by: 'nikhil', d: 24, cat: 'OzoneBlu / IT Support', sub: 'Data mismatch', p: 'Medium', subject: 'Customer address different in quote PDF vs OzoneBlu screen',
    desc: 'Quote PDF prints old address for Aravalli Corporate Park even after updating the customer master.', f: { quote_no: 'QT/GGN/26-27/0390', sales_order_no: 'SO/26-27/1098' },
    steps: [A(2, 'rohit', 'ayesha'), S(3, 'ayesha', 'In Progress'), R(10, 'ayesha', 'PDF template now reads from the latest customer master version.', 'PDF template cached customer snapshot', 'Cache invalidated on master update'), CL(30, 'nikhil')] },
  { by: 'arjun', d: 21, cat: 'Production', sub: 'Manufacturing delay', p: 'High', subject: 'WO-26-1012 delayed — CNC machine breakdown',
    desc: 'Work order for Khurana residence is delayed. Planning was told of a CNC breakdown on Line 1.', f: { sales_order_no: 'SO/26-27/1176', production_order_no: 'WO-26-1012', order_stage: 'Production', customer: 'Mr. Sandeep Khurana', customer_impact: 'Promised dispatch date will be missed' },
    steps: [A(2, 'harpreet', 'ramesh'), S(3, 'ramesh', 'On Hold', 'Spindle motor replacement awaited from vendor'), S(70, 'ramesh', 'In Progress')] },
  { by: 'rakesha', d: 18, cat: 'Installation', sub: 'Incorrect or missing material', p: 'Critical', subject: 'Missing glass units for 3 sliding doors — Villa 14',
    desc: 'Installation team on site but 3 DGU panels for sliding doors are missing from consignment.', f: { customer: 'Mr. Vivek Malhotra (Villa 14)', sales_order_no: 'SO/26-27/1187', order_stage: 'Installation', customer_impact: 'Installation team idle; customer move-in date at risk' },
    steps: [A(1, 'rakeshc', 'vinod'), S(1.5, 'vinod', 'In Progress'), T(3, 'vinod', 'DISP', 'Packing list shows panels not loaded — dispatch to arrange'), A(4, 'gaurav', 'mohit'), S(5, 'mohit', 'In Progress'), R(26, 'mohit', 'Missing DGU panels dispatched by express vehicle and installed.', 'Panels left in staging area during loading', 'Loading checklist signed by supervisor per consignment'), CL(40, 'rakesha')] },
  { by: 'sneha', d: 15, cat: 'Sales', sub: 'Quote revision issue', p: 'Low', subject: 'Quote revision R3 not saving discount remarks',
    desc: 'When revising quote to R3 the discount justification text is lost after save.', f: { quote_no: 'QT/GGN/26-27/0533', customer: 'Orchid Petals Clubhouse', order_stage: 'Quotation' },
    steps: [A(5, 'rajiv', 'simran'), S(6, 'simran', 'In Progress'), T(8, 'simran', 'IT', 'Looks like an OzoneBlu save defect, not a sales process issue'), A(10, 'rohit', 'ayesha'), S(11, 'ayesha', 'Awaiting Information', 'Please share a screen recording of the save step and the browser used.')] },
  { by: 'lokesh', d: 12, cat: 'Survey', sub: 'Survey scheduling', p: 'Medium', subject: 'Survey needed for Rajputana Hotel annexe block',
    desc: 'Hotel has added an annexe with 22 openings; need survey scheduling this week.', f: { customer: 'Rajputana Boutique Hotel', project_location: 'C-Scheme, Jaipur', quote_no: 'QT/JPR/26-27/0160', order_stage: 'Survey' },
    steps: [A(6, 'manoj', 'imran'), S(7, 'imran', 'In Progress'), C(10, 'imran', 'Survey scheduled for Thursday 11 AM. Please confirm site access.'), C(20, 'lokesh', 'Confirmed. Site engineer Mr. Bhati will be present.')] },
  { by: 'nikhil', d: 10, cat: 'Design / Technical', sub: 'Drawing approval issue', p: 'High', subject: 'Shop drawings for Greenwood Tower B pending architect approval',
    desc: 'Architect has comments on mullion sizes. Need technical response to close drawing approval.', f: { dealer: 'DLR-SKY', customer: 'Greenwood Residency (Tower B)', quote_no: 'QT/GGN/26-27/0455', order_stage: 'Design & Technical' },
    steps: [A(3, 'arvind', 'karan'), S(4, 'karan', 'In Progress'), N(30, 'karan', 'Wind-load calculation needed; asked structural consultant.')] },
  { by: 'divya', d: 8, cat: 'Dealer', sub: 'Order status query', p: 'Low', subject: 'Expected dispatch date for Kavya Menon order?',
    desc: 'Customer is asking when material will be dispatched. Please share expected date.', f: { customer: 'Mrs. Kavya Menon', quote_no: 'QT/GGN/26-27/0518', order_stage: 'Costing' },
    steps: [A(4, 'vikas', 'ritika'), S(5, 'ritika', 'In Progress'), C(6, 'ritika', 'Order is awaiting sales order conversion; dispatch ~4 weeks after advance. Will confirm once SO is released.'), R(7, 'ritika', 'Expected timeline shared with dealer.', 'Information request', ''), CL(26, 'divya')] },
  { by: 'arjun', d: 7, cat: 'Dispatch', sub: 'Vehicle or transport issue', p: 'High', subject: 'Transporter cancelled vehicle for Jaipur consignment',
    desc: 'Vehicle booked for SO/26-27/1122 balance material was cancelled last minute.', f: { sales_order_no: 'SO/26-27/1122', customer: 'Mr. Harish Goyal (Farmhouse)', project_location: 'Vaishali Nagar, Jaipur', order_stage: 'Dispatch' },
    steps: [A(2, 'gaurav', 'mohit'), S(3, 'mohit', 'In Progress'), C(5, 'mohit', 'Alternate transporter booked; pickup tomorrow 9 AM.')] },
  { by: 'sameer', d: 6, cat: 'Service', sub: 'Post-installation complaint', p: 'High', subject: 'Water seepage from sliding windows during rain — Sunrise Heights',
    desc: 'Residents of 6 flats report water seepage at the bottom track of sliding windows after heavy rain.', f: { customer: 'Sunrise Heights Society', project_location: 'Sector 150, Noida', sales_order_no: 'SO/26-27/1165', order_stage: 'Service / After-sales', customer_impact: 'Multiple residents affected; society escalation' },
    steps: [A(2, 'anjali', 'tarun'), S(3, 'tarun', 'In Progress'), N(20, 'tarun', 'Drain holes blocked by construction debris in 4 flats; 2 flats have missing end caps.'), S(30, 'anjali', 'Escalated', 'Needs installation team rework on 2 flats; coordinating with Installation')] },
  { by: 'sneha', d: 5, cat: 'Costing', sub: 'BOM or quantity mismatch', p: 'Medium', subject: 'BOM shows 14 handles for 12 windows — Khurana residence',
    desc: 'BOM generated from OzoneBlu lists 14 handle sets while the quote has 12 casement windows.', f: { quote_no: 'QT/DEL/26-27/0301', sales_order_no: 'SO/26-27/1176', customer: 'Mr. Sandeep Khurana', order_stage: 'Costing' },
    steps: [A(3, 'sanjay', 'megha'), S(4, 'megha', 'Awaiting Information', 'Please confirm whether the two French doors are to have handle sets on both sides.')] },
  { by: 'rakesha', d: 4, cat: 'Sales', sub: 'Incorrect customer or order details', p: 'Medium', subject: 'Wrong GST number on quote for Greenwood Residency',
    desc: 'Quote shows the builder\'s old GSTIN. Correct GSTIN is 06AAACG1234F1Z5.', f: { customer: 'Greenwood Residency (Tower B)', quote_no: 'QT/GGN/26-27/0455', order_stage: 'Quotation' },
    steps: [A(5, 'rajiv', 'ankit'), S(6, 'ankit', 'In Progress')] },
  { by: 'nikhil', d: 3.2, cat: 'OzoneBlu / IT Support', sub: 'Login or access issue', p: 'High', subject: 'Cannot access costing screen after role change',
    desc: 'After my role was updated last week I can no longer open the costing summary for my own quotes.', f: { quote_no: 'QT/GGN/26-27/0518' },
    steps: [A(1, 'rohit', 'varun'), S(2, 'varun', 'In Progress'), N(3, 'varun', 'Role template missing "view costing summary" permission. Checking with Costing head if intentional.')] },
  { by: 'jaspreet', d: 3, cat: 'Installation', sub: 'Installation scheduling', p: 'Medium', subject: 'Request installation slot for Mrs. Simran Gill residence',
    desc: 'Material delivered on site. Customer requests installation next Monday or Tuesday.', f: { customer: 'Mrs. Simran Gill', project_location: 'Sector 8, Chandigarh', sales_order_no: 'SO/26-27/1251', order_stage: 'Installation' },
    steps: [] },
  { by: 'pooja', d: 2.5, cat: 'Other / Not sure', sub: 'General query', p: 'Low', subject: 'Architect requesting product catalogue and test certificates',
    desc: 'Architect firm for Orchid Petals Clubhouse wants the latest catalogue and air/water test certificates.', f: { customer: 'Orchid Petals Clubhouse' }, steps: [] },
  { by: 'arjun', d: 2, cat: 'Production', sub: 'Rework requirement', p: 'Medium', subject: 'Rework: wrong handle colour on 6 doors — WO-26-1033',
    desc: 'Doors were assembled with silver handles; order specifies black.', f: { sales_order_no: 'SO/26-27/1240', production_order_no: 'WO-26-1033', order_stage: 'Production', customer: 'Rajputana Boutique Hotel' },
    steps: [A(2, 'harpreet', 'amit')] },
  { by: 'divya', d: 1.6, cat: 'Dealer', sub: 'Documentation issue', p: 'Medium', subject: 'Warranty certificate not received for Villa 14',
    desc: 'Customer needs the warranty certificate for bank loan documentation.', f: { customer: 'Mr. Vivek Malhotra (Villa 14)', sales_order_no: 'SO/26-27/1187', order_stage: 'Installation' }, steps: [] },
  { by: 'sneha', d: 1.2, cat: 'Commercial', sub: 'Billing or invoice issue', p: 'High', subject: 'Invoice raised with wrong place of supply',
    desc: 'Invoice for SO/26-27/1176 shows Haryana as place of supply; site is in Delhi. Customer cannot claim ITC.', f: { sales_order_no: 'SO/26-27/1176', customer: 'Mr. Sandeep Khurana', order_stage: 'Dispatch', customer_impact: 'Customer payment withheld' },
    steps: [A(3, 'priya', 'nitin')] },
  { by: 'lokesh', d: 0.8, cat: 'Production', sub: 'Production completion update', p: 'Low', subject: 'Production completion status for Rajputana Hotel order',
    desc: 'Please confirm whether production for SO/26-27/1240 is complete so we can plan site readiness.', f: { sales_order_no: 'SO/26-27/1240', production_order_no: 'WO-26-1033', order_stage: 'Production', customer: 'Rajputana Boutique Hotel' }, steps: [] },
  { by: 'nikhil', d: 0.4, cat: 'OzoneBlu / IT Support', sub: 'Performance problem', p: 'Medium', subject: 'Quote PDF generation takes over 2 minutes',
    desc: 'Generating PDF for quotes with more than 40 line items takes 2–3 minutes since this morning.', f: { quote_no: 'QT/GGN/26-27/0533' }, steps: [] },
  { by: 'arjun', d: 0.2, cat: 'Survey', sub: 'Resurvey requirement', p: 'High', subject: 'Resurvey needed — site openings changed after plastering, Gomti Greens',
    desc: 'Builder has re-plastered openings in Villas 3–6; previous survey dimensions no longer valid.', f: { dealer: 'DLR-HRT', customer: 'Gomti Greens Villas', project_location: 'Gomti Nagar, Lucknow', order_stage: 'Survey', customer_impact: 'Fabrication must wait for resurvey' }, steps: [] },
  { by: 'sameer', d: 0.1, cat: 'Commercial', sub: 'Credit or outstanding issue', p: 'Medium', subject: 'Outstanding statement does not match our ledger',
    desc: 'Statement shows ₹1.2 lakh outstanding on SO/26-27/1165; our ledger shows fully paid.', f: { sales_order_no: 'SO/26-27/1165', customer: 'Sunrise Heights Society', order_stage: 'Service / After-sales' }, steps: [] },
];

function seedTickets(db, ids) {
  const user = (k) => loadUser(ids[k]);
  const dealerId = (code) => db.prepare('SELECT id FROM dealers WHERE code = ?').get(code)?.id;
  const custId = (n) => db.prepare('SELECT id FROM customers WHERE name = ?').get(n)?.id;
  const nowMs = Date.now();
  let n = 0;
  for (const sc of SCENARIOS) {
    const created = nowMs - sc.d * 86400000;
    const at = (h) => new Date(created + h * 3600000).toISOString();
    const by = user(sc.by);
    const cat = db.prepare('SELECT id FROM ticket_categories WHERE name = ?').get(sc.cat).id;
    const sub = db.prepare('SELECT id FROM ticket_subcategories WHERE category_id = ? AND name = ?').get(cat, sc.sub).id;
    const { dealer, customer, ...rest } = sc.f;
    const input = { subject: sc.subject, description: sc.desc, category_id: cat, subcategory_id: sub, priority: sc.p, ...rest };
    if (dealer) input.dealer_id = dealerId(dealer);
    if (customer) {
      input.customer_id = custId(customer);
      if (!input.customer_id) input.customer_name = customer;
    }
    setClock(at(0));
    const t = db.transaction(() => svc.createTicket(by, input))();
    for (const st of sc.steps) {
      const when = created + st.h * 3600000;
      if (when > nowMs) break;
      setClock(new Date(when).toISOString());
      const actor = user(st.who);
      const fresh = svc.loadTicket(t.id);
      db.transaction(() => {
        if (st.act === 'assign') svc.assign(actor, fresh, { user_id: ids[st.to], reason: st.reason });
        if (st.act === 'status') svc.changeStatus(actor, fresh, st);
        if (st.act === 'comment') svc.addComment(actor, fresh, { body: st.body });
        if (st.act === 'note') svc.addComment(actor, fresh, { body: st.body, is_internal: true });
        if (st.act === 'transfer') svc.transfer(actor, fresh, { department_id: db.prepare('SELECT id FROM departments WHERE code = ?').get(st.dept).id, reason: st.reason });
      })();
    }
    n++;
  }
  setClock(null);
  // Older notifications are treated as already read so the bell reflects recent activity
  db.prepare("UPDATE notifications SET is_read = 1 WHERE created_at < ?").run(new Date(nowMs - 3 * 86400000).toISOString());
  return n;
}

function seedAll(db, { demo = true } = {}) {
  db.transaction(() => seedReference(db))();
  const ids = db.transaction(() => seedPeople(db))();
  const n = demo ? seedTickets(db, ids) : 0;
  return { ids, tickets: n };
}

module.exports = { seedAll, DEMO_PASSWORD, USERS };

if (require.main === module) {
  const file = config.dbFile;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  const db = open(file);
  setDb(db);
  const { tickets } = seedAll(db, { demo: process.argv.includes('--no-demo') ? false : true });
  console.log(`Seeded database at ${file} with ${tickets} demo tickets. Demo password for all users: ${DEMO_PASSWORD}`);
  getDb().close();
}
