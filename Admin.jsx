import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, qs } from '../api';
import { useApp } from '../ctx';
import { Icon } from '../icons';
import { Empty, Field, Modal, Spinner } from '../components/ui';
import { fmtDateTime } from '../format';

const yes = (v) => (v ? <span className="sla sla-ok"><Icon name="check" size={13} />Yes</span> : <span className="muted">No</span>);
const active = (v) => (v ? <span className="badge s-in-progress">Active</span> : <span className="badge s-closed">Disabled</span>);
const mins = (m) => (m == null ? '—' : m === 0 ? 'Immediately' : m % 540 === 0 ? `${m / 540} business day${m === 540 ? '' : 's'}` : m >= 60 && m % 60 === 0 ? `${m / 60} business hour${m === 60 ? '' : 's'}` : `${m} min`);

/** Generic CRUD table driven by a column/field config */
function CrudTable({ endpoint, title, intro, columns, fields, defaults = {}, deletable, onChange, rowFilter, extraActions }) {
  const { toast } = useApp();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState({});
  const load = useCallback(() => api.get(`/api/admin/${endpoint}`).then(setRows), [endpoint]);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    try {
      const body = Object.fromEntries(fields.map((f) => [f.key, edit[f.key]]));
      if (body.password === '') delete body.password;
      if (edit.id) await api.patch(`/api/admin/${endpoint}/${edit.id}`, body); else await api.post(`/api/admin/${endpoint}`, body);
      toast('Saved'); setEdit(null); setErr({}); load(); onChange?.();
    } catch (x) { setErr({ ...x.details, form: x.message }); }
  };
  const remove = async (r) => {
    if (!window.confirm('Delete this record?')) return;
    await api.del(`/api/admin/${endpoint}/${r.id}`); toast('Deleted'); load(); onChange?.();
  };
  const shown = rows ? (rowFilter ? rows.filter(rowFilter) : rows) : null;
  return (
    <div className="card">
      <div className="card-head"><div><h2>{title}</h2>{intro && <div className="sub2">{intro}</div>}</div><span className="spacer" />{extraActions}
        <button className="btn btn-sm btn-primary" onClick={() => { setErr({}); setEdit({ ...defaults }); }}><Icon name="plus" size={14} />Add</button></div>
      {!shown ? <Spinner /> : shown.length === 0 ? <Empty title="Nothing configured yet" /> : (
        <div className="table-wrap"><table className="data">
          <thead><tr>{columns.map(([, l]) => <th key={l}>{l}</th>)}<th /></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id} onClick={() => { setErr({}); setEdit({ ...r }); }}>
              {columns.map(([k, l, render]) => <td key={l} className="small">{render ? render(r[k], r) : r[k] ?? '—'}</td>)}
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setErr({}); setEdit({ ...r }); }}><Icon name="edit" size={14} /></button>
                {deletable && <button className="btn btn-sm btn-ghost btn-danger" onClick={(e) => { e.stopPropagation(); remove(r); }} aria-label="Delete"><Icon name="x" size={14} /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && (
        <Modal title={`${edit.id ? 'Edit' : 'Add'} ${title.replace(/s$/, '').toLowerCase()}`} onClose={() => setEdit(null)} width={640}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
          {err.form && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err.form}</div>}
          <div className="grid g2">
            {fields.filter((f) => !f.show || f.show(edit)).map((f) => (
              <Field key={f.key} label={f.label} required={f.required} error={err[f.key]} hint={f.hint} className={f.wide ? 'span-all' : ''}>
                {f.type === 'bool' ? (
                  <label className="row small"><input type="checkbox" checked={!!edit[f.key]} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.checked })} /> {f.checkLabel || 'Enabled'}</label>
                ) : f.type === 'select' ? (
                  <select className="select" value={edit[f.key] ?? ''} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })}>
                    {!f.noEmpty && <option value="">{f.empty || '—'}</option>}
                    {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : f.type === 'multi' ? (
                  <div className="grid g2" style={{ gap: 4 }}>
                    {f.options.map(([v, l]) => {
                      const cur = Array.isArray(edit[f.key]) ? edit[f.key] : JSON.parse(edit[f.key] || '[]');
                      return <label key={v} className="row small"><input type="checkbox" checked={cur.includes(v)} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.checked ? [...cur, v] : cur.filter((x) => x !== v) })} />{l}</label>;
                    })}
                  </div>
                ) : (
                  <input className="input" type={f.type || 'text'} value={edit[f.key] ?? ''} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} placeholder={f.placeholder} />
                )}
              </Field>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function useAdminList(endpoint) {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => api.get(`/api/admin/${endpoint}`).then(setRows).catch(() => {}), [endpoint]);
  useEffect(() => { load(); }, [load]);
  return [rows, load];
}

function Users() {
  const { meta } = useApp();
  const roles = Object.entries(meta.roleLabels);
  return (
    <CrudTable endpoint="users" title="Users" intro="Role decides what a user can do; department decides which queue they work; dealer users only ever see their dealership's tickets."
      defaults={{ role: 'creator', is_active: true }}
      columns={[['name', 'Name', (v, r) => <><b>{v}</b><div className="sub2">{r.email}</div></>], ['role', 'Role', (v) => meta.roleLabels[v]], ['department_name', 'Department'], ['dealer_name', 'Dealer'], ['last_login_at', 'Last login', (v) => (v ? fmtDateTime(v) : 'Never')], ['is_active', 'Status', active]]}
      fields={[
        { key: 'name', label: 'Full name', required: true }, { key: 'email', label: 'Email', required: true, type: 'email' },
        { key: 'role', label: 'Role', type: 'select', options: roles, noEmpty: true, required: true },
        { key: 'department_id', label: 'Department', type: 'select', options: meta.departments.map((d) => [d.id, d.name]), show: (e) => e.role !== 'dealer', hint: 'Required for support team and department heads' },
        { key: 'dealer_id', label: 'Dealer', type: 'select', options: meta.dealers.map((d) => [d.id, d.name]), show: (e) => e.role === 'dealer', required: true },
        { key: 'designation', label: 'Designation' }, { key: 'phone', label: 'Phone' },
        { key: 'password', label: 'Password', type: 'password', hint: 'Initial password, or leave blank to keep the current one (min 8 characters)' },
        { key: 'is_active', label: 'Account', type: 'bool', checkLabel: 'Active (can sign in)' },
      ]} />
  );
}

function Categories() {
  const { meta, reloadMeta } = useApp();
  const [cats, reloadCats] = useAdminList('categories');
  const [catId, setCatId] = useState('');
  const fieldOpts = meta.fields.map((f) => [f.key, f.label]);
  const depts = meta.departments.map((d) => [d.id, d.name]);
  const dn = (id) => meta.departments.find((d) => d.id === id)?.name || <span className="muted">Central triage</span>;
  const refresh = () => { reloadCats(); reloadMeta(); };
  return (
    <div className="stack">
      <CrudTable endpoint="categories" title="Categories" intro="Default routing department, dynamic form fields and closure approval per category. Changes apply immediately — no code changes needed."
        defaults={{ is_active: true, visible_fields: [], required_fields: [], sort_order: 99 }} onChange={refresh}
        columns={[['sort_order', '#'], ['name', 'Category', (v) => <b>{v}</b>], ['department_id', 'Routes to', dn], ['is_software', 'Software', yes], ['requires_closure_approval', 'Closure approval', yes],
          ['required_fields', 'Mandatory fields', (v) => JSON.parse(v || '[]').map((k) => meta.fields.find((f) => f.key === k)?.label).join(', ') || '—'], ['is_active', 'Status', active]]}
        fields={[
          { key: 'name', label: 'Name', required: true }, { key: 'department_id', label: 'Default department', type: 'select', options: depts, empty: '— Central triage —' },
          { key: 'sort_order', label: 'Display order', type: 'number' }, { key: 'description', label: 'Description' },
          { key: 'is_software', label: 'Issue type', type: 'bool', checkLabel: 'Software / OzoneBlu issue' },
          { key: 'requires_closure_approval', label: 'Closure', type: 'bool', checkLabel: 'Requires department-head approval to close' },
          { key: 'visible_fields', label: 'Fields shown on the form', type: 'multi', options: fieldOpts, wide: true },
          { key: 'required_fields', label: 'Mandatory fields', type: 'multi', options: fieldOpts, wide: true },
          { key: 'is_active', label: 'Status', type: 'bool', checkLabel: 'Active' },
        ]} />
      <CrudTable endpoint="subcategories" title="Subcategories" intro="Optionally route a subcategory to a different department than its category."
        defaults={{ is_active: true, category_id: catId, sort_order: 99 }} onChange={refresh} rowFilter={catId ? (r) => String(r.category_id) === String(catId) : undefined}
        extraActions={<select className="select" style={{ width: 'auto' }} value={catId} onChange={(e) => setCatId(e.target.value)} aria-label="Filter by category"><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        columns={[['category_id', 'Category', (v) => cats.find((c) => c.id === v)?.name], ['sort_order', '#'], ['name', 'Subcategory', (v) => <b>{v}</b>], ['department_id', 'Routing override', (v) => (v ? dn(v) : <span className="muted">Category default</span>)], ['is_active', 'Status', active]]}
        fields={[
          { key: 'category_id', label: 'Category', type: 'select', options: cats.map((c) => [c.id, c.name]), required: true }, { key: 'name', label: 'Name', required: true },
          { key: 'department_id', label: 'Routing override', type: 'select', options: depts, empty: '— Use category default —' }, { key: 'sort_order', label: 'Display order', type: 'number' },
          { key: 'is_active', label: 'Status', type: 'bool', checkLabel: 'Active' },
        ]} />
    </div>
  );
}

function Routing() {
  const { meta } = useApp();
  const subs = meta.categories.flatMap((c) => c.subcategories.map((s) => [s.id, `${c.name} › ${s.name}`]));
  return (
    <CrudTable endpoint="routing_rules" title="Routing rules" deletable
      intro="Evaluated in rank order before category/subcategory defaults. Blank criteria match anything (at least one of category, subcategory or stage is required). Unmatched tickets go to central triage."
      defaults={{ is_active: true, rank: 100 }}
      columns={[['rank', 'Rank'], ['name', 'Rule', (v) => <b>{v}</b>], ['category_id', 'Category', (v) => meta.categories.find((c) => c.id === v)?.name || 'Any'],
        ['subcategory_id', 'Subcategory', (v) => subs.find(([id]) => id === v)?.[1].split(' › ')[1] || 'Any'], ['order_stage', 'Stage', (v) => v || 'Any'], ['priority', 'Priority', (v) => v || 'Any'],
        ['department_id', 'Route to', (v) => meta.departments.find((d) => d.id === v)?.name], ['is_active', 'Status', active]]}
      fields={[
        { key: 'name', label: 'Rule name', required: true, wide: true }, { key: 'category_id', label: 'Category', type: 'select', options: meta.categories.map((c) => [c.id, c.name]), empty: 'Any' },
        { key: 'subcategory_id', label: 'Subcategory', type: 'select', options: subs, empty: 'Any' }, { key: 'order_stage', label: 'Order stage', type: 'select', options: meta.stages.map((s) => [s, s]), empty: 'Any' },
        { key: 'priority', label: 'Priority', type: 'select', options: meta.priorities.map((p) => [p, p]), empty: 'Any' },
        { key: 'department_id', label: 'Route to department', type: 'select', options: meta.departments.map((d) => [d.id, d.name]), required: true },
        { key: 'assign_user_id', label: 'Auto-assign to (optional)', type: 'select', options: meta.staff.map((s) => [s.id, s.name]) }, { key: 'rank', label: 'Rank (lower runs first)', type: 'number' },
        { key: 'is_active', label: 'Status', type: 'bool', checkLabel: 'Active' },
      ]} />
  );
}

function Sla() {
  const { meta } = useApp();
  return (
    <div className="stack">
      <div className="alert alert-warn"><b>These are configurable targets, not existing Ozone policy.</b> The seeded values are suggestions awaiting approval by Ozone management. Minutes are business minutes per the working hours in Settings (1 business day = 540 min at 09:30–18:30).</div>
      <CrudTable endpoint="sla_policies" title="SLA policies" intro="Most specific match wins: category + department, then department, then priority-only."
        defaults={{ is_active: true, pause_on_awaiting_info: true, priority: 'Medium' }}
        columns={[['name', 'Policy', (v) => <b>{v}</b>], ['priority', 'Priority'], ['department_id', 'Department', (v) => meta.departments.find((d) => d.id === v)?.name || 'All'],
          ['category_id', 'Category', (v) => meta.categories.find((c) => c.id === v)?.name || 'All'], ['first_response_minutes', 'First response', mins], ['resolution_minutes', 'Resolution', mins],
          ['pause_on_awaiting_info', 'Pause on info request', yes], ['is_active', 'Status', active]]}
        fields={[
          { key: 'name', label: 'Name', required: true, wide: true }, { key: 'priority', label: 'Priority', type: 'select', options: meta.priorities.map((p) => [p, p]), noEmpty: true },
          { key: 'department_id', label: 'Department', type: 'select', options: meta.departments.map((d) => [d.id, d.name]), empty: 'All departments' },
          { key: 'category_id', label: 'Category', type: 'select', options: meta.categories.map((c) => [c.id, c.name]), empty: 'All categories' },
          { key: 'first_response_minutes', label: 'First response target (business minutes)', type: 'number', required: true },
          { key: 'resolution_minutes', label: 'Resolution target (business minutes)', type: 'number', required: true },
          { key: 'pause_on_awaiting_info', label: 'Awaiting Information', type: 'bool', checkLabel: 'Pause resolution clock' },
          { key: 'pause_on_hold', label: 'On Hold', type: 'bool', checkLabel: 'Pause resolution clock' }, { key: 'is_active', label: 'Status', type: 'bool', checkLabel: 'Active' },
        ]} />
      <CrudTable endpoint="escalation_rules" title="Escalation rules" deletable intro="Phase 2: stored now, executed by the SLA monitor job in the automation phase."
        defaults={{ is_active: true, level: 1, minutes_after: 0, trigger_type: 'resolution_breach' }}
        columns={[['level', 'Level'], ['name', 'Rule', (v) => <b>{v}</b>], ['trigger_type', 'Trigger'], ['minutes_after', 'Delay', mins], ['priority', 'Priority', (v) => v || 'All'], ['notify_role', 'Notify'], ['is_active', 'Status', active]]}
        fields={[
          { key: 'name', label: 'Name', required: true, wide: true }, { key: 'trigger_type', label: 'Trigger', type: 'select', noEmpty: true, options: [['warning', 'Approaching deadline'], ['first_response_breach', 'First-response breach'], ['resolution_breach', 'Resolution breach']] },
          { key: 'minutes_after', label: 'Delay after trigger (business minutes)', type: 'number' }, { key: 'priority', label: 'Priority', type: 'select', options: meta.priorities.map((p) => [p, p]), empty: 'All' },
          { key: 'department_id', label: 'Department', type: 'select', options: meta.departments.map((d) => [d.id, d.name]), empty: 'All' },
          { key: 'notify_role', label: 'Notify', type: 'select', options: [['agent', 'Assigned employee'], ['manager', 'Department head'], ['admin', 'Management / admin']] },
          { key: 'level', label: 'Escalation level', type: 'number' }, { key: 'is_active', label: 'Status', type: 'bool', checkLabel: 'Active' },
        ]} />
      <CrudTable endpoint="holidays" title="Holidays" deletable intro="Excluded from business-hour SLA calculation. Verify dates against Ozone's official holiday list."
        columns={[['date', 'Date'], ['name', 'Holiday']]} fields={[{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'name', label: 'Name', required: true }]} />
    </div>
  );
}

function Organisation() {
  const { meta, reloadMeta } = useApp();
  return (
    <div className="stack">
      <CrudTable endpoint="departments" title="Departments" onChange={reloadMeta} defaults={{ is_active: true, sort_order: 99 }}
        columns={[['sort_order', '#'], ['code', 'Code'], ['name', 'Department', (v) => <b>{v}</b>], ['is_triage', 'Triage queue', yes], ['sees_all', 'Sees all tickets', yes], ['is_active', 'Status', active]]}
        fields={[{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }, { key: 'email', label: 'Team email' }, { key: 'sort_order', label: 'Display order', type: 'number' },
          { key: 'is_triage', label: 'Triage', type: 'bool', checkLabel: 'Central triage queue for unrouted tickets' }, { key: 'sees_all', label: 'Visibility', type: 'bool', checkLabel: 'Heads of this department can view all tickets (e.g. Management)' },
          { key: 'is_active', label: 'Status', type: 'bool', checkLabel: 'Active' }]} />
      <CrudTable endpoint="dealers" title="Dealers" onChange={reloadMeta} defaults={{ is_active: true }}
        columns={[['code', 'Code'], ['name', 'Dealer', (v) => <b>{v}</b>], ['city', 'City'], ['contact_person', 'Contact'], ['phone', 'Phone'], ['is_active', 'Status', active]]}
        fields={[{ key: 'code', label: 'Dealer code', required: true, hint: 'Must match dealer_code in OzoneBlu imports' }, { key: 'name', label: 'Name', required: true }, { key: 'city', label: 'City' }, { key: 'contact_person', label: 'Contact person' },
          { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'is_active', label: 'Status', type: 'bool', checkLabel: 'Active' }]} />
      <CrudTable endpoint="customers" title="Customers"
        columns={[['name', 'Customer / project', (v) => <b>{v}</b>], ['location', 'Location'], ['dealer_id', 'Dealer', (v) => meta.dealers.find((d) => d.id === v)?.name || 'Direct']]}
        fields={[{ key: 'name', label: 'Name', required: true }, { key: 'location', label: 'Location' }, { key: 'dealer_id', label: 'Dealer', type: 'select', options: meta.dealers.map((d) => [d.id, d.name]), empty: 'Direct customer' },
          { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'is_confidential', label: 'Confidential', type: 'bool', checkLabel: 'Restrict commercial details' }]} />
      <CrudTable endpoint="order_stages" title="Order lifecycle stages" onChange={reloadMeta} defaults={{ is_active: true }}
        columns={[['sort_order', '#'], ['name', 'Stage'], ['is_active', 'Status', active]]}
        fields={[{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }, { key: 'sort_order', label: 'Order', type: 'number' }, { key: 'is_active', label: 'Status', type: 'bool', checkLabel: 'Active' }]} />
    </div>
  );
}

const EVENT_LABELS = { ticket_created: 'Ticket created', ticket_assigned: 'Ticket assigned', ticket_reassigned: 'Ticket reassigned', status_changed: 'Status changed', info_requested: 'Information requested',
  comment_added: 'New comment', ticket_escalated: 'Ticket escalated', sla_warning: 'SLA deadline approaching', sla_breached: 'SLA breached', ticket_resolved: 'Ticket resolved', ticket_closed: 'Ticket closed', ticket_reopened: 'Ticket reopened' };

function Settings() {
  const { toast, reloadMeta } = useApp();
  const [s, setS] = useState(null);
  const [n, setN] = useState([]);
  useEffect(() => { api.get('/api/admin/settings').then(setS); api.get('/api/admin/notification_settings').then(setN); }, []);
  if (!s) return <Spinner />;
  const save = async () => { await api.put('/api/admin/settings', s); toast('Settings saved'); reloadMeta(); };
  const toggle = async (row, k) => {
    const next = { ...row, [k]: row[k] ? 0 : 1 };
    await api.put(`/api/admin/notification_settings/${row.event_type}`, next);
    setN(n.map((x) => (x.event_type === row.event_type ? next : x)));
  };
  const F = (k, l, h, type = 'text') => <Field key={k} label={l} hint={h}><input className="input" type={type} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></Field>;
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <h2>General &amp; business calendar</h2>
        <div className="grid g3">
          {F('company_name', 'Company name')}
          {F('timezone', 'Display time zone', 'IANA name, e.g. Asia/Kolkata')}
          {F('tz_offset_minutes', 'UTC offset for SLA (minutes)', 'IST = 330')}
          <Field label="SLA clock"><select className="select" value={s.sla_clock} onChange={(e) => setS({ ...s, sla_clock: e.target.value })}><option value="business">Business hours</option><option value="calendar">24×7 calendar time</option></select></Field>
          {F('work_start', 'Working day starts', 'HH:MM', 'time')}
          {F('work_end', 'Working day ends', 'HH:MM', 'time')}
          {F('work_days', 'Working days', '0=Sun … 6=Sat, comma separated')}
          {F('reopen_window_days', 'Reopen window (days)', 'Requesters can reopen closed tickets within this period', 'number')}
          {F('max_upload_mb', 'Max upload size shown to users (MB)', 'Server hard limit is set by MAX_UPLOAD_MB', 'number')}
        </div>
        <div><button className="btn btn-primary" onClick={save}>Save settings</button></div>
      </div>
      <div className="card">
        <div className="card-head"><div><h2>Notifications</h2><div className="sub2">In-app notifications are live. Email records are queued for the Phase 2 mail worker (configure SMTP_* in the server environment).</div></div></div>
        <div className="table-wrap"><table className="data"><thead><tr><th>Event</th><th>In-app</th><th>Email</th></tr></thead>
          <tbody>{n.map((r) => (
            <tr key={r.event_type} style={{ cursor: 'default' }}><td>{EVENT_LABELS[r.event_type] || r.event_type}</td>
              <td><input type="checkbox" checked={!!r.in_app} onChange={() => toggle(r, 'in_app')} aria-label={`In-app for ${r.event_type}`} /></td>
              <td><input type="checkbox" checked={!!r.email} onChange={() => toggle(r, 'email')} aria-label={`Email for ${r.event_type}`} /></td></tr>
          ))}</tbody></table></div>
      </div>
    </div>
  );
}

function OzoneBlu() {
  const { toast } = useApp();
  const [csv, setCsv] = useState('');
  const [res, setRes] = useState(null);
  const [rows, setRows] = useState([]);
  const load = () => api.get('/api/admin/ozoneblu/references').then(setRows);
  useEffect(() => { load(); }, []);
  const run = async () => {
    try { const r = await api.post('/api/admin/ozoneblu/import', { csv }); setRes(r); toast(`${r.imported} references imported`); load(); }
    catch (x) { setRes({ error: x.message }); }
  };
  return (
    <div className="stack">
      <div className="alert alert-info"><b>Integration readiness.</b> No direct OzoneBlu API is assumed. Until approved API access exists, upload an authorised CSV export of quote / order references here. Users get suggestions when typing quote or order numbers; dealers only see their own dealer code. Nothing is scraped and OzoneBlu is never modified.</div>
      <div className="card card-pad stack">
        <h2>Import references (CSV)</h2>
        <p className="hint">Columns: <code>quote_no, sales_order_no, customer_name, dealer_code, project_location, order_stage</code>. Existing quote numbers are updated.</p>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => setCsv(await e.target.files[0]?.text() || '')} />
        <textarea className="textarea" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'quote_no,sales_order_no,customer_name,dealer_code,project_location,order_stage\nQT/GGN/26-27/0600,,New Customer,DLR-SKY,"Sector 56, Gurugram",Quotation'} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} />
        <div className="row"><button className="btn btn-primary" onClick={run} disabled={!csv.trim()}>Import</button>
          {res?.error && <span className="field-error">{res.error}</span>}
          {res && !res.error && <span className="small">{res.imported} imported{res.errors.length ? `, ${res.errors.length} skipped: ${res.errors.slice(0, 3).join('; ')}` : ''}</span>}</div>
      </div>
      <div className="card"><div className="card-head"><h2>Current references</h2><span className="muted small" style={{ marginLeft: 'auto' }}>{rows.length}</span></div>
        <div className="table-wrap" style={{ maxHeight: 420 }}><table className="data"><thead><tr><th>Quote</th><th>Sales order</th><th>Customer</th><th>Dealer code</th><th>Stage</th><th>Updated</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} style={{ cursor: 'default' }}><td className="small">{r.quote_no || '—'}</td><td className="small">{r.sales_order_no || '—'}</td><td className="small">{r.customer_name}</td><td className="small">{r.dealer_code || '—'}</td><td className="small">{r.order_stage}</td><td className="small">{fmtDateTime(r.updated_at)}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}

function Audit() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/api/admin/audit${qs({ q, page })}`).then(setData); }, [q, page]);
  return (
    <div className="card">
      <div className="card-head"><h2>Audit log</h2><span className="spacer" />
        <input className="input" style={{ maxWidth: 260 }} placeholder="Filter by action, ticket or user" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      {!data ? <Spinner /> : (
        <>
          <div className="table-wrap"><table className="data"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id} style={{ cursor: 'default' }}><td className="small tabnum">{fmtDateTime(r.created_at)}</td><td className="small">{r.user_name || 'System'}</td><td className="small"><code>{r.action}</code></td>
                <td className="small">{r.entity} {r.entity_id}</td><td className="small" style={{ maxWidth: 360, wordBreak: 'break-word' }}>{r.details}</td><td className="small">{r.ip || ''}</td></tr>
            ))}</tbody></table></div>
          <div className="pager"><span className="small muted">{data.total} entries</span><span className="spacer" />
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn btn-sm" disabled={page * 50 >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>
        </>
      )}
    </div>
  );
}

const TABS = [['users', 'Users', Users], ['categories', 'Categories', Categories], ['routing', 'Routing', Routing], ['sla', 'SLA & escalation', Sla],
  ['organisation', 'Departments & dealers', Organisation], ['settings', 'Settings & notifications', Settings], ['ozoneblu', 'OzoneBlu import', OzoneBlu], ['audit', 'Audit log', Audit]];

export default function Admin() {
  return (
    <div>
      <div className="page-head"><div><h1>Administration</h1><p>Configure users, routing, SLA targets and workflow without code changes. Every change is audit-logged.</p></div></div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {TABS.map(([k, l]) => <NavLink key={k} to={`/admin/${k}`} className={({ isActive }) => `btn btn-ghost ${isActive ? 'btn-primary' : ''}`} style={{ borderRadius: 8, marginBottom: 6 }}>{l}</NavLink>)}
      </div>
      <Routes>
        <Route index element={<Navigate to="users" replace />} />
        {TABS.map(([k, , C]) => <Route key={k} path={k} element={<C />} />)}
      </Routes>
    </div>
  );
}
