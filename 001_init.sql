-- Ozone Issue Tracker — initial schema
-- All timestamps stored as ISO-8601 UTC strings; displayed in configured time zone.

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,            -- creator | dealer | agent | manager | admin
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_triage INTEGER NOT NULL DEFAULT 0,
  sees_all INTEGER NOT NULL DEFAULT 0,  -- e.g. Management: read access to all tickets
  head_user_id INTEGER,
  email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE dealers (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  location TEXT,
  dealer_id INTEGER REFERENCES dealers(id),
  is_confidential INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_customers_dealer ON customers(dealer_id);
CREATE INDEX idx_customers_name ON customers(name);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  department_id INTEGER REFERENCES departments(id),
  dealer_id INTEGER REFERENCES dealers(id),
  designation TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_users_dept ON users(department_id);
CREATE INDEX idx_users_dealer ON users(dealer_id);

CREATE TABLE order_stages (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE ticket_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),   -- default routing target
  is_software INTEGER NOT NULL DEFAULT 0,               -- software vs operational issue
  requires_closure_approval INTEGER NOT NULL DEFAULT 0,
  visible_fields TEXT NOT NULL DEFAULT '[]',           -- JSON array of optional field keys shown
  required_fields TEXT NOT NULL DEFAULT '[]',          -- JSON array of field keys required
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ticket_subcategories (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES ticket_categories(id),
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),   -- optional routing override
  default_priority TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_subcat_cat ON ticket_subcategories(category_id);

-- Configurable routing rules (evaluated before category/subcategory defaults)
CREATE TABLE routing_rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES ticket_categories(id),
  subcategory_id INTEGER REFERENCES ticket_subcategories(id),
  order_stage TEXT,
  priority TEXT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  assign_user_id INTEGER REFERENCES users(id),
  rank INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- SLA targets are CONFIGURABLE, not existing Ozone policy.
CREATE TABLE sla_policies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  priority TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  category_id INTEGER REFERENCES ticket_categories(id),
  first_response_minutes INTEGER NOT NULL,
  resolution_minutes INTEGER NOT NULL,
  pause_on_awaiting_info INTEGER NOT NULL DEFAULT 1,
  pause_on_hold INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Phase 2: escalation rules (schema ready)
CREATE TABLE escalation_rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,          -- first_response_breach | resolution_breach | warning
  minutes_after INTEGER NOT NULL DEFAULT 0,
  priority TEXT,
  department_id INTEGER REFERENCES departments(id),
  notify_role TEXT,                    -- agent | manager | admin
  notify_user_id INTEGER REFERENCES users(id),
  level INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE ticket_sequences (
  year INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL
);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  ticket_no TEXT NOT NULL UNIQUE,      -- immutable public identifier, e.g. OZ-2026-00001
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  requester_department_id INTEGER REFERENCES departments(id),
  requester_role TEXT,
  dealer_id INTEGER REFERENCES dealers(id),
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  project_location TEXT,
  quote_no TEXT,
  sales_order_no TEXT,
  survey_ref TEXT,
  production_order_no TEXT,
  order_stage TEXT,
  category_id INTEGER NOT NULL REFERENCES ticket_categories(id),
  subcategory_id INTEGER REFERENCES ticket_subcategories(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  priority TEXT NOT NULL CHECK (priority IN ('Critical','High','Medium','Low')),
  status TEXT NOT NULL,
  assigned_user_id INTEGER REFERENCES users(id),
  expected_resolution_date TEXT,
  customer_impact TEXT,
  related_ticket_id INTEGER REFERENCES tickets(id),
  routed_by TEXT,                      -- rule | subcategory | category | triage | manual
  sla_policy_id INTEGER REFERENCES sla_policies(id),
  sla_first_response_due TEXT,
  sla_resolution_due TEXT,
  sla_paused_at TEXT,
  sla_paused_minutes INTEGER NOT NULL DEFAULT 0,
  first_response_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id),
  reopen_count INTEGER NOT NULL DEFAULT 0,
  transfer_count INTEGER NOT NULL DEFAULT 0,
  root_cause TEXT,
  corrective_action TEXT,
  resolution_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_dept ON tickets(department_id, status);
CREATE INDEX idx_tickets_assigned ON tickets(assigned_user_id, status);
CREATE INDEX idx_tickets_requester ON tickets(requester_id);
CREATE INDEX idx_tickets_dealer ON tickets(dealer_id);
CREATE INDEX idx_tickets_quote ON tickets(quote_no);
CREATE INDEX idx_tickets_so ON tickets(sales_order_no);
CREATE INDEX idx_tickets_created ON tickets(created_at);
CREATE INDEX idx_tickets_category ON tickets(category_id, subcategory_id);

-- Prevent the public ticket number from ever changing
CREATE TRIGGER trg_ticket_no_immutable BEFORE UPDATE OF ticket_no ON tickets
BEGIN
  SELECT RAISE(ABORT, 'ticket_no is immutable');
END;

CREATE TABLE ticket_assignments (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  department_id INTEGER REFERENCES departments(id),
  from_user_id INTEGER REFERENCES users(id),
  to_user_id INTEGER REFERENCES users(id),
  assigned_by INTEGER REFERENCES users(id),
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_assign_ticket ON ticket_assignments(ticket_id);

-- Public comments (is_internal = 0) and internal notes (is_internal = 1)
CREATE TABLE ticket_comments (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'comment',   -- comment | info_request | resolution
  created_at TEXT NOT NULL
);
CREATE INDEX idx_comments_ticket ON ticket_comments(ticket_id);

-- Convenience view so reporting can treat internal notes as their own entity
CREATE VIEW internal_notes AS
  SELECT id, ticket_id, user_id, body, created_at FROM ticket_comments WHERE is_internal = 1;

CREATE TABLE ticket_attachments (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  comment_id INTEGER REFERENCES ticket_comments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_attach_ticket ON ticket_attachments(ticket_id);

CREATE TABLE ticket_status_history (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id),   -- NULL = system
  remarks TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_status_hist_ticket ON ticket_status_history(ticket_id);

CREATE TABLE ticket_transfers (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  from_department_id INTEGER REFERENCES departments(id),
  to_department_id INTEGER NOT NULL REFERENCES departments(id),
  transferred_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_transfer_ticket ON ticket_transfers(ticket_id);

-- Unified, append-only activity timeline for each ticket
CREATE TABLE ticket_events (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  user_id INTEGER REFERENCES users(id),
  event_type TEXT NOT NULL,   -- created | status | assigned | transferred | comment | note | attachment | updated | reopened | resolved | closed
  is_internal INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL,
  data TEXT,                  -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_ticket ON ticket_events(ticket_id, created_at);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  ticket_id INTEGER REFERENCES tickets(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  channel TEXT NOT NULL DEFAULT 'in_app',   -- in_app | email
  is_read INTEGER NOT NULL DEFAULT 0,
  delivered_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notif_user ON notifications(user_id, is_read, created_at);

CREATE TABLE notification_settings (
  event_type TEXT PRIMARY KEY,
  in_app INTEGER NOT NULL DEFAULT 1,
  email INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

CREATE TABLE saved_views (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  filters TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- OzoneBlu integration readiness: manually imported reference data (no scraping, no direct DB access)
CREATE TABLE ozoneblu_references (
  id INTEGER PRIMARY KEY,
  quote_no TEXT,
  sales_order_no TEXT,
  customer_name TEXT,
  dealer_code TEXT,
  project_location TEXT,
  order_stage TEXT,
  source TEXT NOT NULL DEFAULT 'manual_import',
  imported_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_ob_quote ON ozoneblu_references(quote_no) WHERE quote_no IS NOT NULL;
CREATE INDEX idx_ob_so ON ozoneblu_references(sales_order_no);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE holidays (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
