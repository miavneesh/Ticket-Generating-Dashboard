const STATUSES = ['New', 'Submitted', 'Assigned', 'In Progress', 'Awaiting Information', 'On Hold', 'Escalated', 'Resolved', 'Closed'];
const OPEN_STATUSES = STATUSES.filter((s) => !['Resolved', 'Closed'].includes(s));
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// Default workflow for staff (department / support team / managers / admin)
const TRANSITIONS = {
  New: ['Submitted', 'Assigned'],
  Submitted: ['Assigned', 'In Progress', 'Awaiting Information', 'Escalated'],
  Assigned: ['In Progress', 'Awaiting Information', 'On Hold', 'Escalated', 'Resolved'],
  'In Progress': ['Awaiting Information', 'On Hold', 'Escalated', 'Resolved'],
  'Awaiting Information': ['In Progress', 'On Hold', 'Escalated', 'Resolved'],
  'On Hold': ['In Progress', 'Awaiting Information', 'Escalated', 'Resolved'],
  Escalated: ['In Progress', 'Awaiting Information', 'On Hold', 'Resolved'],
  Resolved: ['Closed', 'In Progress'],
  Closed: ['In Progress'],
};

const REMARKS_REQUIRED = new Set(['Awaiting Information', 'On Hold', 'Escalated']);

// Optional ticket fields that categories can show / require
const FIELD_DEFS = [
  { key: 'dealer_id', label: 'Dealer' },
  { key: 'customer_name', label: 'Customer name' },
  { key: 'project_location', label: 'Customer / project location' },
  { key: 'quote_no', label: 'OzoneBlu quote number' },
  { key: 'sales_order_no', label: 'OzoneBlu sales order number' },
  { key: 'survey_ref', label: 'Survey reference number' },
  { key: 'production_order_no', label: 'Production / work order number' },
  { key: 'order_stage', label: 'Order lifecycle stage' },
  { key: 'customer_impact', label: 'Impact on customer or order' },
  { key: 'expected_resolution_date', label: 'Expected resolution date' },
  { key: 'related_ticket_no', label: 'Related ticket' },
];
const FIELD_KEYS = FIELD_DEFS.map((f) => f.key);

const ROLE_LABELS = { creator: 'Employee', dealer: 'Dealer', agent: 'Support Team', manager: 'Department Head', admin: 'System Administrator' };

module.exports = { STATUSES, OPEN_STATUSES, PRIORITIES, TRANSITIONS, REMARKS_REQUIRED, FIELD_DEFS, FIELD_KEYS, ROLE_LABELS };
