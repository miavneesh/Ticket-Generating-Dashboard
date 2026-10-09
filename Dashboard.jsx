import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, Filler } from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { api, qs } from '../api';
import { useApp } from '../ctx';
import { Icon } from '../icons';
import { Empty, Spinner } from '../components/ui';
import { fmtShort } from '../format';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, Filler);

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
function fyStart() {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}
const RANGES = [['7d', 'Last 7 days', () => [daysAgo(6), today()]], ['30d', 'Last 30 days', () => [daysAgo(29), today()]], ['90d', 'Last 90 days', () => [daysAgo(89), today()]],
  ['fy', 'This FY', () => [fyStart(), today()]], ['all', 'All time', () => ['', '']]];

function chartTheme() {
  return {
    s1: css('--series-1'), s2: css('--series-2'), grid: css('--grid'), axis: css('--axis'), muted: css('--muted'), text: css('--text-2'),
    seq: ['--seq-250', '--seq-350', '--seq-450', '--seq-550', '--seq-600', '--seq-700'].map(css), surface: css('--chart-surface'),
  };
}

function baseOptions(th, { horizontal = false, onClick, unit = '' } = {}) {
  const valueAxis = { beginAtZero: true, grid: { color: th.grid, drawTicks: false }, border: { display: false }, ticks: { color: th.muted, precision: 0, padding: 6, font: { size: 11.5 } } };
  const catAxis = { grid: { display: false }, border: { color: th.axis }, ticks: { color: th.text, font: { size: 11.5 }, autoSkip: !horizontal } };
  return {
    responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x', animation: { duration: 250 },
    interaction: { mode: 'nearest', intersect: false, axis: horizontal ? 'y' : 'x' },
    scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: '#16202c', padding: 10, cornerRadius: 6, displayColors: false, callbacks: { label: (c) => `${c.dataset.label}: ${c.formattedValue}${unit}` } },
    },
    onClick: onClick ? (_e, els) => els[0] && onClick(els[0].index) : undefined,
    onHover: onClick ? (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } : undefined,
  };
}
const barDs = (label, data, color, extra = {}) => ({ label, data, backgroundColor: color, hoverBackgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26, categoryPercentage: 0.8, barPercentage: 0.9, ...extra });

function ChartCard({ title, sub, span = 'c6', table, legend, children, tall }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card ${span}`}>
      <div className="card-head">
        <div><h2>{title}</h2>{sub && <div className="sub2">{sub}</div>}</div>
        {legend}
        {table && <button className="btn btn-sm btn-ghost table-toggle" style={{ marginLeft: legend ? 8 : 'auto' }} onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>{asTable ? 'Chart' : 'Table'}</button>}
      </div>
      {asTable && table ? (
        <div className="table-wrap" style={{ maxHeight: tall ? 320 : 260, overflow: 'auto' }}>
          <table className="data"><thead><tr>{table.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i} style={{ cursor: 'default' }}>{r.map((c, j) => <td key={j} className="tabnum">{c}</td>)}</tr>)}</tbody></table>
        </div>
      ) : <div className={`chart-box ${tall ? 'tall' : ''}`}>{children}</div>}
    </section>
  );
}

export default function Dashboard() {
  const { meta, user, can } = useApp();
  const nav = useNavigate();
  const [range, setRange] = useState('30d');
  const [f, setF] = useState({ department_id: '', category_id: '', priority: '', status: '', dealer_id: '', assigned_user_id: '', issue_type: '' });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [th, setTh] = useState(chartTheme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => setTh(chartTheme());
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  const [from, to] = RANGES.find((r) => r[0] === range)[2]();
  const filters = useMemo(() => ({ ...f, from, to }), [f, from, to]);
  useEffect(() => {
    setErr('');
    api.get(`/api/dashboard${qs(filters)}`).then(setData).catch((e) => setErr(e.message));
  }, [filters]);

  const go = (extra) => nav(`/tickets${qs({ ...filters, ...extra, view: extra.view || 'all' })}`);
  if (err) return <div className="alert alert-error">{err}</div>;
  if (!data) return <Spinner />;
  const s = data.summary;

  const KPIS = [
    ['Total tickets', s.total, {}, 'list'], ['New / awaiting triage', s.new, { status: 'New,Submitted' }, 'inbox'], ['Open', s.open, { open: '1' }, 'flag'],
    ['Unassigned', s.unassigned, { view: 'unassigned' }, 'userPlus'], ['In progress', s.in_progress, { status: 'In Progress' }, 'arrowRight'],
    ['Awaiting information', s.awaiting_info, { status: 'Awaiting Information' }, 'info'], ['Escalated', s.escalated, { status: 'Escalated' }, 'alert', true],
    ['Overdue', s.overdue, { overdue: '1' }, 'clock', true], ['Resolved this month', s.resolved_this_month, { resolved_from: data.monthStart, from: '', to: '' }, 'check'], ['Closed', s.closed, { status: 'Closed' }, 'lock'],
  ];

  const ageBounds = { '< 1 day': [0, 1], '1–3 days': [1, 3], '3–7 days': [3, 7], '7–15 days': [7, 15], '15–30 days': [15, 30], '30+ days': [30, 3650] };
  const hasData = s.total > 0;
  const sel = (key, label, options) => (
    <select className="select" style={{ width: 'auto', minWidth: 140 }} aria-label={label} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
      <option value="">{label}: all</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div>
      <div className="page-head">
        <div><h1>Dashboard</h1><p>{can.staff ? (user.role === 'admin' || user.dept_sees_all ? 'All departments' : `Tickets for ${user.department_name} and tickets you raised`) : can.dealer ? `Tickets for ${user.dealer_name}` : 'Tickets you have raised'} · live from stored ticket data</p></div>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 4 }} role="group" aria-label="Date range">
          {RANGES.map(([k, l]) => <button key={k} className={`chip ${range === k ? 'on' : ''}`} onClick={() => setRange(k)}>{l}</button>)}
        </div>
        {can.staff && sel('department_id', 'Department', meta.departments.map((d) => [d.id, d.name]))}
        {sel('category_id', 'Category', meta.categories.map((c) => [c.id, c.name]))}
        {sel('priority', 'Priority', meta.priorities.map((p) => [p, p]))}
        {sel('status', 'Status', meta.statuses.map((x) => [x, x]))}
        {can.staff && sel('dealer_id', 'Dealer', meta.dealers.map((d) => [d.id, d.name]))}
        {can.staff && sel('assigned_user_id', 'Assignee', meta.staff.map((x) => [x.id, x.name]))}
        {sel('issue_type', 'Type', [['software', 'Software'], ['operational', 'Operational']])}
      </div>

      <div className="kpis">
        {KPIS.map(([label, v, extra, icon, alertish]) => (
          <a key={label} href="#" className={`card kpi ${alertish && v > 0 ? 'alert-kpi' : ''}`} onClick={(e) => { e.preventDefault(); go(extra); }}>
            <div className="label"><Icon name={icon} size={14} />{label}</div>
            <div className="value tabnum">{v}</div>
          </a>
        ))}
      </div>

      {!hasData ? (
        <div className="card" style={{ marginTop: 16 }}><Empty icon="chart" title="No tickets in this range">Widen the date range or clear filters.<div style={{ marginTop: 12 }}><Link className="btn btn-sm" to="/create">Create a ticket</Link></div></Empty></div>
      ) : (
        <div className="charts">
          <ChartCard span="c8" title="Created vs resolved" sub={data.trend.granularity === 'month' ? 'Per month' : 'Per day'}
            legend={<span className="legend"><span><i style={{ background: th.s1 }} />Created</span><span><i style={{ background: th.s2 }} />Resolved</span></span>}
            table={{ cols: ['Period', 'Created', 'Resolved'], rows: data.trend.labels.map((l, i) => [l, data.trend.created[i], data.trend.resolved[i]]) }}>
            <Line data={{ labels: data.trend.labels.map((l) => (l.length === 7 ? l : fmtShort(l))),
              datasets: [
                { label: 'Created', data: data.trend.created, borderColor: th.s1, backgroundColor: th.s1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, cubicInterpolationMode: 'monotone' },
                { label: 'Resolved', data: data.trend.resolved, borderColor: th.s2, backgroundColor: th.s2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, cubicInterpolationMode: 'monotone' },
              ] }}
              options={{ ...baseOptions(th), interaction: { mode: 'index', intersect: false }, plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, displayColors: true } } }} />
          </ChartCard>

          <section className="card c4">
            <div className="card-head"><h2>SLA compliance</h2><span className="sub2" style={{ marginLeft: 'auto' }}>Configurable targets</span></div>
            <div className="gauge">
              {[['Resolution within target', data.sla.resolution_compliance, `${data.sla.resolved_on_time} of ${data.sla.resolved_with_sla} resolved tickets`],
                ['First response within target', data.sla.first_response_compliance, 'Measured separately from resolution']].map(([l, v, sub]) => (
                <div key={l} style={{ flex: '1 1 180px' }}>
                  <div className="small muted">{l}</div>
                  <div className="big tabnum">{v == null ? '—' : `${v}%`}</div>
                  <div className="meter" role="meter" aria-valuenow={v ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={l}><span style={{ width: `${v ?? 0}%` }} /></div>
                  <div className="sub2" style={{ marginTop: 4 }}>{sub}</div>
                </div>
              ))}
              <a href="#" className="small" onClick={(e) => { e.preventDefault(); go({ overdue: '1' }); }} style={{ flex: '1 1 100%' }}>
                <Icon name="alert" size={13} /> {data.sla.open_overdue} open ticket{data.sla.open_overdue === 1 ? ' is' : 's are'} past the resolution target →
              </a>
            </div>
          </section>

          <ChartCard span="c6" title="Tickets by department" sub="Click a bar to open the list" tall
            table={{ cols: ['Department', 'Total', 'Open', 'Overdue'], rows: data.byDepartment.map((r) => [r.label, r.total, r.open, r.overdue]) }}>
            <Bar data={{ labels: data.byDepartment.map((r) => r.label), datasets: [barDs('Tickets', data.byDepartment.map((r) => r.total), th.s1)] }}
              options={{ ...baseOptions(th, { horizontal: true, onClick: (i) => go({ department_id: data.byDepartment[i].id }) }),
                plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => { const r = data.byDepartment[c.dataIndex]; return [`Total: ${r.total}`, `Open: ${r.open}`, `Overdue: ${r.overdue}`]; } } } } }} />
          </ChartCard>

          <ChartCard span="c6" title="Tickets by category" sub="Click a bar to open the list" tall
            table={{ cols: ['Category', 'Total', 'Open'], rows: data.byCategory.map((r) => [r.label, r.total, r.open]) }}>
            <Bar data={{ labels: data.byCategory.map((r) => r.label), datasets: [barDs('Tickets', data.byCategory.map((r) => r.total), th.s1)] }}
              options={{ ...baseOptions(th, { horizontal: true, onClick: (i) => go({ category_id: data.byCategory[i].id }) }),
                plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => { const r = data.byCategory[c.dataIndex]; return [`Total: ${r.total}`, `Open: ${r.open}`]; } } } } }} />
          </ChartCard>

          <ChartCard span="c4" title="By priority" table={{ cols: ['Priority', 'Total', 'Open'], rows: data.byPriority.map((r) => [r.label, r.total, r.open]) }}>
            <Bar data={{ labels: data.byPriority.map((r) => r.label), datasets: [barDs('Tickets', data.byPriority.map((r) => r.total), th.s1)] }}
              options={baseOptions(th, { onClick: (i) => go({ priority: data.byPriority[i].label }) })} />
          </ChartCard>

          <ChartCard span="c4" title="By status" table={{ cols: ['Status', 'Total'], rows: data.byStatus.map((r) => [r.label, r.total]) }}>
            {(() => {
              const rows = meta.statuses.map((st) => data.byStatus.find((x) => x.label === st) || { label: st, total: 0 }).filter((r) => r.total > 0);
              return <Bar data={{ labels: rows.map((r) => r.label), datasets: [barDs('Tickets', rows.map((r) => r.total), th.s1)] }}
                options={baseOptions(th, { horizontal: true, onClick: (i) => go({ status: rows[i].label }) })} />;
            })()}
          </ChartCard>

          <ChartCard span="c4" title="Ageing of open tickets" sub="Time since creation"
            table={{ cols: ['Age', 'Open tickets'], rows: data.ageing.map((r) => [r.label, r.total]) }}>
            {data.ageing.length === 0 ? <Empty icon="check" title="No open tickets" /> : (
              <Bar data={{ labels: data.ageing.map((r) => r.label), datasets: [barDs('Open tickets', data.ageing.map((r) => r.total), data.ageing.map((r) => th.seq[r.ord - 1]))] }}
                options={baseOptions(th, { onClick: (i) => { const [lo, hi] = ageBounds[data.ageing[i].label]; go({ open: '1', from: daysAgo(hi), to: daysAgo(lo) }); } })} />
            )}
          </ChartCard>

          <ChartCard span="c6" title="Average resolution time by department" sub="Hours from creation to resolution"
            table={{ cols: ['Department', 'Avg hours', 'Resolved tickets'], rows: data.resolutionByDept.map((r) => [r.label, r.hours, r.n]) }}>
            {data.resolutionByDept.length === 0 ? <Empty icon="clock" title="No resolved tickets yet" /> : (
              <Bar data={{ labels: data.resolutionByDept.map((r) => r.label), datasets: [barDs('Avg resolution', data.resolutionByDept.map((r) => r.hours), th.s1)] }}
                options={baseOptions(th, { horizontal: true, unit: ' h', onClick: (i) => go({ department_id: data.resolutionByDept[i].id, status: 'Resolved,Closed' }) })} />
            )}
          </ChartCard>

          <section className="card c6">
            <div className="card-head"><h2>Most frequent recurring issues</h2><span className="sub2" style={{ marginLeft: 'auto' }}>Subcategories reported 2+ times</span></div>
            {data.recurring.length === 0 ? <Empty icon="check" title="No recurring issues in this range" /> : (
              <ul className="rank-list">
                {data.recurring.map((r) => {
                  const max = data.recurring[0].total;
                  return (
                    <li key={`${r.category_id}-${r.subcategory_id}`}>
                      <a href="#" onClick={(e) => { e.preventDefault(); go({ category_id: r.category_id, subcategory_id: r.subcategory_id || '' }); }}>
                        <span className="small">{r.label}</span><span className="small tabnum"><b>{r.total}</b> <span className="muted">({r.open} open)</span></span>
                        <span className="bar"><span style={{ width: `${(100 * r.total) / max}%` }} /></span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
