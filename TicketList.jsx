import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useApp } from '../ctx';
import { Icon } from '../icons';
import { Empty, PriorityBadge, SlaBadge, StatusBadge, useClickOutside } from '../components/ui';
import { fmtDate, fmtDateTime, ago, ticketAge } from '../format';

const FILTER_KEYS = ['q', 'resolved_from', 'status', 'priority', 'department_id', 'category_id', 'dealer_id', 'assigned_user_id', 'issue_type', 'from', 'to', 'overdue', 'open', 'order_stage', 'subcategory_id'];

const COLS = [
  ['ticket_no', 'Ticket ID', true], ['subject', 'Subject / Category', true], [null, 'Quote / Order'], [null, 'Requester'], [null, 'Dealer / Customer'],
  ['department', 'Department', true], ['assigned', 'Assigned', true], ['priority', 'Priority', true], ['status', 'Status', true],
  ['created_at', 'Created', true], ['updated_at', 'Last updated', true], ['age', 'Age', true], ['sla_resolution_due', 'SLA due', true],
];

function SavedViews({ params, onApply }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState([]);
  const ref = useRef();
  useClickOutside(ref, useCallback(() => setOpen(false), []));
  const load = () => api.get('/api/views').then(setViews).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    const name = window.prompt('Name this view (e.g. "Critical Noida installs")');
    if (!name) return;
    const filters = Object.fromEntries([...params.entries()].filter(([k]) => k !== 'page'));
    await api.post('/api/views', { name, filters });
    toast('View saved'); load();
  };
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn btn-sm" onClick={() => setOpen(!open)}><Icon name="bookmark" size={15} />Saved views</button>
      {open && (
        <div className="popover menu-list" style={{ width: 280 }}>
          {views.length === 0 && <div className="small muted" style={{ padding: 14 }}>No saved views yet.</div>}
          {views.map((v) => (
            <div key={v.id} className="row" style={{ paddingRight: 8 }}>
              <button style={{ flex: 1 }} onClick={() => { onApply(v.filters); setOpen(false); }}>{v.name}</button>
              <button className="btn-ghost" style={{ width: 'auto' }} aria-label={`Delete ${v.name}`} onClick={async () => { await api.del(`/api/views/${v.id}`); load(); }}><Icon name="x" size={14} /></button>
            </div>
          ))}
          <button onClick={save} style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}><Icon name="plus" size={14} /> Save current filters</button>
        </div>
      )}
    </div>
  );
}

export default function TicketList({ cfg }) {
  const { meta, user, can } = useApp();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [showFilters, setShowFilters] = useState(() => FILTER_KEYS.some((k) => k !== 'q' && params.get(k)));
  const [qInput, setQInput] = useState(params.get('q') || '');

  const view = params.has('view') ? params.get('view') : cfg.tabs[0][0];
  const query = useMemo(() => {
    const o = Object.fromEntries(params.entries());
    o.view = view;
    if (cfg.deptScoped && user.department_id && view !== 'department') o.department_id = o.department_id || user.department_id;
    return o;
  }, [params, view, cfg.deptScoped, user.department_id]);

  useEffect(() => {
    let live = true;
    setErr('');
    api.get(`/api/tickets${qs({ ...query, pageSize: 25 })}`).then((d) => live && setData(d)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [query]);
  useEffect(() => setQInput(params.get('q') || ''), [params]);

  const set = (patch) => {
    const p = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === '' || v == null ? p.delete(k) : p.set(k, v)));
    if (!('page' in patch)) p.delete('page');
    setParams(p);
  };
  const sort = params.get('sort') || 'updated_at';
  const dir = params.get('dir') || 'desc';
  const toggleSort = (k) => set({ sort: k, dir: sort === k && dir === 'desc' ? 'asc' : 'desc' });
  const activeFilters = FILTER_KEYS.filter((k) => params.get(k)).length;
  const page = Number(params.get('page') || 1);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const exportHref = (format) => `/api/tickets/export${qs({ ...query, format })}`;
  const deptStaff = meta.staff;

  const sel = (key, label, options, extra) => (
    <label className="field"><span className="small muted">{label}</span>
      <select className="select" value={params.get(key) || ''} onChange={(e) => set({ [key]: e.target.value })} {...extra}>
        <option value="">Any</option>
        {params.get(key) && !options.some(([v]) => String(v) === params.get(key)) && <option value={params.get(key)}>Custom selection</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div>
      <div className="page-head">
        <div><h1>{cfg.title}</h1><p>{cfg.sub}</p></div>
        <span className="spacer" />
        <SavedViews params={params} onApply={(f) => setParams(new URLSearchParams(f))} />
        <a className="btn btn-sm" href={exportHref('xlsx')}><Icon name="download" size={15} />Excel</a>
        <a className="btn btn-sm" href={exportHref('csv')}><Icon name="download" size={15} />CSV</a>
      </div>

      <div className="row" style={{ marginBottom: 12, gap: 6 }} role="tablist">
        {cfg.tabs.map(([v, l]) => (
          <button key={v || 'all'} role="tab" aria-selected={view === v} className={`chip ${view === v ? 'on' : ''}`} onClick={() => set({ view: v === cfg.tabs[0][0] ? '' : v || 'all' })}>{l}</button>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <form className="search" style={{ maxWidth: 380 }} onSubmit={(e) => { e.preventDefault(); set({ q: qInput.trim() }); }}>
            <Icon name="search" size={16} />
            <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Ticket ID, quote/order no., customer, dealer…" aria-label="Search within list" />
          </form>
          <button className={`btn btn-sm ${showFilters ? 'btn-primary' : ''}`} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
            <Icon name="filter" size={15} />Filters{activeFilters ? ` (${activeFilters})` : ''}
          </button>
          {activeFilters > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setParams(params.get('view') ? new URLSearchParams({ view: params.get('view') }) : new URLSearchParams())}>Clear all</button>}
          <span className="spacer" />
          <span className="small muted tabnum">{data ? `${data.total} ticket${data.total === 1 ? '' : 's'}` : ''}</span>
        </div>
        {showFilters && (
          <div className="filters">
            {sel('status', 'Status', [['New,Submitted,Assigned,In Progress,Awaiting Information,On Hold,Escalated', 'All open'], ...meta.statuses.map((s) => [s, s])])}
            {sel('priority', 'Priority', meta.priorities.map((p) => [p, p]))}
            {sel('department_id', 'Department', meta.departments.map((d) => [d.id, d.name]))}
            {sel('category_id', 'Category', meta.categories.map((c) => [c.id, c.name]))}
            {!can.dealer && sel('dealer_id', 'Dealer', meta.dealers.map((d) => [d.id, d.name]))}
            {can.staff && sel('assigned_user_id', 'Assigned to', [['none', '— Unassigned —'], ...deptStaff.map((s) => [s.id, s.name])])}
            {sel('issue_type', 'Issue type', [['software', 'Software (OzoneBlu)'], ['operational', 'Operational']])}
            {sel('order_stage', 'Order stage', meta.stages.map((s) => [s, s]))}
            <label className="field"><span className="small muted">Created from</span><input type="date" className="input" value={params.get('from') || ''} onChange={(e) => set({ from: e.target.value })} /></label>
            <label className="field"><span className="small muted">Created to</span><input type="date" className="input" value={params.get('to') || ''} onChange={(e) => set({ to: e.target.value })} /></label>
            <label className="row small" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={params.get('overdue') === '1'} onChange={(e) => set({ overdue: e.target.checked ? '1' : '' })} /> Overdue only</label>
          </div>
        )}
        {err && <div className="alert alert-error" style={{ margin: 16 }}>{err}</div>}
        {!data && !err && <div style={{ padding: 16 }}>{[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: 36, marginBottom: 8 }} />)}</div>}
        {data && data.rows.length === 0 && (
          <Empty icon="inbox" title="No tickets match">
            {activeFilters ? 'Try removing a filter or widening the date range.' : 'Nothing here right now.'}
            <div style={{ marginTop: 12 }}><Link className="btn btn-sm" to="/create"><Icon name="plus" size={14} />Create a ticket</Link></div>
          </Empty>
        )}
        {data && data.rows.length > 0 && (
          <>
            <div className="table-wrap tickets">
              <table className="data">
                <thead><tr>{COLS.map(([k, l, s]) => (
                  <th key={l} className={s ? 'sortable' : ''} onClick={s ? () => toggleSort(k) : undefined} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {l}{sort === k && <span style={{ display: 'inline-block', transform: dir === 'asc' ? 'rotate(180deg)' : 'none', verticalAlign: -2, marginLeft: 2 }}><Icon name="chevronDown" size={12} stroke={2.5} /></span>}
                  </th>
                ))}</tr></thead>
                <tbody>
                  {data.rows.map((t) => (
                    <tr key={t.id} className={t.is_overdue ? 'overdue' : ''} onClick={() => nav(`/tickets/${t.ticket_no}`)}>
                      <td><Link className="tid" to={`/tickets/${t.ticket_no}`} onClick={(e) => e.stopPropagation()}>{t.ticket_no}</Link></td>
                      <td><div className="subj">{t.subject}</div><div className="sub2">{t.category_name}{t.subcategory_name ? ` › ${t.subcategory_name}` : ''}{t.is_software ? ' · Software' : ''}</div></td>
                      <td className="small">{t.quote_no || '—'}{t.sales_order_no && <div className="sub2">{t.sales_order_no}</div>}</td>
                      <td className="small">{t.requester_name}</td>
                      <td className="small">{t.dealer_name || '—'}{t.customer_name && <div className="sub2">{t.customer_name}</div>}</td>
                      <td className="small">{t.department_name}</td>
                      <td className="small">{t.assigned_name || <span className="muted">Unassigned</span>}</td>
                      <td><PriorityBadge priority={t.priority} /></td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="small tabnum" title={fmtDateTime(t.created_at)}>{fmtDate(t.created_at)}</td>
                      <td className="small tabnum" title={fmtDateTime(t.updated_at)}>{ago(t.updated_at)}</td>
                      <td className="small tabnum">{ticketAge(t)}</td>
                      <td><SlaBadge t={t} /><div className="sub2 tabnum">{t.sla_resolution_due ? fmtDateTime(t.sla_resolution_due) : ''}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ticket-cards">
              {data.rows.map((t) => (
                <Link key={t.id} className="tcard" to={`/tickets/${t.ticket_no}`}>
                  <div className="top"><span className="tid">{t.ticket_no}</span><span className="spacer" /><StatusBadge status={t.status} /></div>
                  <div className="subj">{t.subject}</div>
                  <div className="sub2">{t.category_name} · {t.department_name}{t.assigned_name ? ` · ${t.assigned_name}` : ''}</div>
                  <div className="row" style={{ marginTop: 6 }}><PriorityBadge priority={t.priority} /><SlaBadge t={t} /><span className="spacer" /><span className="sub2">{ticketAge(t)} old</span></div>
                </Link>
              ))}
            </div>
            <div className="pager">
              <span className="small muted tabnum">Showing {(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of {data.total}</span>
              <span className="spacer" />
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => set({ page: page - 1 })} aria-label="Previous page"><Icon name="chevronLeft" size={15} /></button>
              <span className="small tabnum">Page {page} / {pages}</span>
              <button className="btn btn-sm" disabled={page >= pages} onClick={() => set({ page: page + 1 })} aria-label="Next page"><Icon name="chevronRight" size={15} /></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
