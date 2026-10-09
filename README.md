# Ozone Issue Tracker — Phase 1 MVP

Centralized ticket management for **Ozone Corp. Pvt. Ltd., Gurgaon**. Employees, dealers, departments and management raise, route, work and close issues across the OzoneBlu order lifecycle (quotation → design → costing → survey → commercial → planning → production → dispatch → installation → service). Every action is kept in a permanent audit trail.

A working full-stack application. All tickets, assignments, status changes, comments, notifications and reports use data stored in the database. Nothing is hard-coded or held only in the browser.

---

## Quick start

Requirements: **Node.js 20+** (tested on 22). No external database is needed for the pilot.

```bash
npm run setup        # installs server + client, builds the UI, creates the DB with demo data
npm start            # http://localhost:4000
```

Sign in with any demo account. The password for all of them is **`Ozone@123`**, and the login page has one-click buttons.

| Role | Account |
|---|---|
| Employee (Sales Executive) | `nikhil.jain@ozone.demo` |
| Dealer: Skyline Fenestration | `rakesh@skyline.demo` (colleague: `divya@skyline.demo`) |
| Dealer: Urban Windows | `sameer@urbanwindows.demo` |
| Support Team: Costing | `megha.arora@ozone.demo` |
| Department Head: Production | `harpreet.singh@ozone.demo` |
| Helpdesk / Triage Lead | `neha.kapoor@ozone.demo` |
| Management (sees all departments) | `alok.mehra@ozone.demo` |
| System Administrator | `admin@ozone.demo` |

Every department has a head and one or two support users. See `server/src/db/seed.js` for the full list.

Other commands:

```bash
npm test             # 30 automated tests (multi-role API workflows + SLA calendar)
npm run seed         # reset the database to the demo dataset (DESTRUCTIVE)
npm run backup       # consistent online backup of DB + attachments to ./backups/<timestamp>
npm run dev:server   # API with auto-reload on :4000
npm run dev:client   # Vite dev server on :5173 (proxies /api to :4000)
```

To start a clean production database without demo tickets, run `node server/src/db/seed.js --no-demo`. This loads departments, categories, SLA targets and the demo user directory. Replace the users through **Administration → Users**, then set `DEMO_MODE=false`.

---

## Architecture

```
client/  React 18 + Vite SPA (responsive; Chart.js dashboards)
server/  Node.js + Express 5 REST API
  src/db/migrations/   versioned SQL migrations (run automatically on start)
  src/db/seed.js       reference data + realistic demo scenarios
  src/lib/             business logic (one place for every rule)
    ticketService.js   create / status workflow / assign / transfer / comments / detail
    permissions.js     server-side RBAC + dealer isolation (used by every route)
    routing.js         rule → subcategory → category → central triage
    sla.js             business-hours SLA calculator (holidays, working days)
    notify.js          in-app notifications (+ queued email records)
    ticketQuery.js     shared filters for lists, dashboard and reports
    attachments.js     upload validation (extension + MIME + magic bytes, size limit)
  src/routes/          auth, tickets, analytics (dashboard/reports), meta, admin
  test/                node:test + supertest
data/     SQLite database (WAL mode)
uploads/  attachment storage (random file names, never served statically)
```

**Database:** SQLite through `better-sqlite3`, which is suitable for a pilot of a few hundred users on one server. The schema is plain relational SQL with foreign keys and indexes, so it can move to PostgreSQL or SQL Server when Ozone IT standardises. The SQL is ANSI apart from small date functions concentrated in `analytics.js` and `ticketQuery.js`.

**Core tables:** users, roles, departments, dealers, customers, tickets, ticket_categories, ticket_subcategories, routing_rules, ticket_assignments, ticket_comments (with an `internal_notes` view), ticket_attachments, ticket_status_history, ticket_transfers, ticket_events (unified timeline), sla_policies, escalation_rules, notifications, notification_settings, audit_logs, saved_views, ozoneblu_references, settings, holidays, order_stages.

- Ticket IDs (`OZ-YYYY-NNNNN`) come from a per-year sequence inside the creating transaction. A database trigger makes `ticket_no` immutable.
- All timestamps are stored in UTC (ISO-8601) and displayed in the configured time zone (default Asia/Kolkata).
- History tables are append-only. Tickets are never deleted, and transfers keep the same row, ID, comments and attachments.

---

## Security model

- **Authentication:** bcrypt-hashed passwords and a JWT in an httpOnly, SameSite=Lax cookie (12 h). Login is rate-limited, and failed or successful logins are audited.
- **CSRF:** every mutating API call must carry the `X-Requested-With: OzoneTracker` header.
- **Authorization is server-side only.** `permissions.js` drives every list, detail, download, dashboard and report query.
  - **Dealers** see only tickets whose `dealer_id` is their own dealership. On create, `dealer_id` is forced to their own dealership, and they can attach only their own customers and OzoneBlu references.
  - **Employees** see tickets they raised.
  - **Support team / heads** see their department's tickets, plus read-only visibility of tickets their department transferred out.
  - **Management** (departments flagged "sees all") and **admins** see everything.
  - A ticket you cannot see returns **404**, so IDs cannot be probed by editing URLs or API calls.
- **Internal notes and attachments** are visible only to Ozone support staff. They are filtered from detail responses, timelines, downloads and notifications. Dealers cannot post internal notes even by forging the request.
- **Uploads:** an allow-list of extensions and MIME types, magic-byte checks for images and PDFs, a size limit, random storage names, and authorised streaming only (`nosniff`, attachment disposition for non-previewable files). A failed upload rolls back the whole ticket.
- **Other protections:** Helmet security headers with a strict CSP. The server refuses to start in production without `JWT_SECRET`.
- **Backups:** run `npm run backup`, which uses SQLite's online backup API and copies the uploads. Schedule it daily and keep copies off-server. To restore, stop the app and copy the `.db` and `uploads/` back.

---

## What Phase 1 includes

| Spec area | Status |
|---|---|
| Auth & 5 roles (Employee, Dealer, Support Team, Department Head, Admin) + Management visibility | ✅ |
| Ticket form: all spec fields, category-driven dynamic and mandatory fields, attachments | ✅ |
| OzoneBlu quote / order lookup from admin-imported references | ✅ |
| Workflow New → Submitted → Assigned → In Progress → Awaiting Info / On Hold / Escalated → Resolved → Closed. Reopen and reject resolution. Remarks required where needed. No closure without resolution details. Closure approval by category | ✅ |
| Routing: configurable rules → subcategory → category → central triage; preview on the form | ✅ (originally planned for Phase 2) |
| Manual assign / reassign / self-assign; transfer with reason, keeping the ID and history | ✅ |
| Public comments vs internal notes (visually distinct), evidence uploads on comments | ✅ |
| Full activity timeline, status history, assignment and transfer history | ✅ |
| Search by ticket ID, quote/SO/WO/survey number, customer, dealer; filters, sorting, pagination, quick views, saved views, CSV/Excel export | ✅ |
| Dashboard: 10 clickable KPI cards and 9 charts, filterable, with table view for accessibility | ✅ |
| SLA targets (business hours, holidays, pause on Awaiting Info) with first response and resolution measured separately | ✅ calculation and display |
| In-app notifications for all listed events; per-event in-app/email settings; notification log | ✅ in-app (email is queued) |
| 13 management reports with filters (incl. software vs operational) and CSV/Excel export | ✅ |
| Administration: users, departments, dealers, customers, categories/subcategories (add/edit/disable/reorder, field config), routing rules, SLA policies, escalation rules, holidays, settings, OzoneBlu import, audit log | ✅ |
| Responsive desktop/tablet/mobile, light and dark themes | ✅ |

### SLA targets are configurable, not Ozone policy

The seeded targets are **suggestions pending management approval**. They can be changed under **Administration → SLA & escalation** and are calculated in business time (09:30–18:30, Mon–Sat, minus holidays; all configurable).

| Priority | First response | Resolution |
|---|---|---|
| Critical | 1 business hour | 1 business day |
| High | 4 business hours | 3 business days |
| Medium | 1 business day | 5 business days |
| Low | 2 business days | 10 business days |

Seeded holidays are examples. Please verify them against Ozone's official calendar.

---

## Roadmap

**Phase 2: Automation.** The tables for this already exist.
- An SLA monitor job that sends warnings at X%, marks breaches and applies `escalation_rules` (notify head, then management).
- An email worker that sends the `notifications` rows with `channel='email'` through `SMTP_*`.
- Department-level scheduled reports.

**Phase 3: Advanced.**
- OzoneBlu integration through an approved API or export. The `ozoneblu_references` table is the integration seam: replace the CSV import with a sync job. Ticket fields already hold quote, SO and stage.
- Root-cause clustering and recurring-issue alerts.
- Advanced management dashboards.

OzoneBlu is never scraped, accessed directly or modified. Integration waits for approved access.

---

## Acceptance criteria → evidence

| # | Criterion | Where it is verified |
|---|---|---|
| 1 | Employee or dealer creates a ticket | tests: *ticket creation*; E2E browser run |
| 2 | Unique ticket ID | tests: sequential + immutable trigger |
| 3 | Correct department or triage queue | tests: *routing rules, subcategory overrides and the central triage queue* |
| 4 | Authorised status updates and communication | tests: *status workflow*; outsider gets 404 |
| 5 | Every action in history | status history assertion; `ticket_events` + `audit_logs` |
| 6 | Track creation → closure | tests: full lifecycle incl. reopen |
| 7 | Managers see overdue and escalated | Escalations page, dashboard KPIs, *open_overdue* report |
| 8 | Dealer isolation | tests: *another dealer cannot see, list, search or act on it* |
| 9 | Reports use stored data | tests: *dashboard totals reflect stored data* |
| 10 | Attachments and internal notes respect permissions | tests: *internal notes and internal attachments are hidden* |
| 11 | Desktop and mobile | responsive layout; no horizontal page scroll at 390 px |
| 12 | Multi-role testing | 30 automated tests across 12 demo users |
