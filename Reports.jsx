import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useApp } from '../ctx';
import { Icon } from '../icons';
import { Empty, Spinner } from '../components/ui';
import { fmtDateTime } from '../format';

export default function Reports() {
  const { meta, user } = useApp();
  const [list, setList] = useState([]);
  const [type, setType] = useState('department_performance');
  const [f, setF] = useState({ from: '', to: '', issue_type: '', department_id: '' });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/api/reports').then(setList); }, []);
  useEffect(() => {
    setData(null); setErr('');
    api.get(`/api/reports/${type}${qs(f)}`).then(setData).catch((e) => setErr(e.message));
  }, [type, f]);
  const isDate = (c, v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v);
  const scope = user.role === 'admin' || user.dept_sees_all ? 'All departments' : `${user.department_name} (your department)`;

  return (
    <div>
      <div className="page-head">
        <div><h1>Reports &amp; Analytics</h1><p>Computed live from stored tickets · Scope: {scope}</p></div>
        <span className="spacer" />
        <a className="btn btn-sm" href={`/api/reports/${type}${qs({ ...f, format: 'xlsx' })}`}><Icon name="download" size={15} />Excel</a>
        <a className="btn btn-sm" href={`/api/reports/${type}${qs({ ...f, format: 'csv' })}`}><Icon name="download" size={15} />CSV</a>
      </div>
      <div className="detail reports-grid">
        <nav className="card" aria-label="Reports" style={{ padding: 6 }}>
          {list.map((r) => (
            <button key={r.key} className={`btn btn-ghost ${type === r.key ? 'btn-primary' : ''}`} style={{ width: '100%', justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left', marginBottom: 2 }} onClick={() => setType(r.key)}>{r.title}</button>
          ))}
        </nav>
        <div className="card">
          <div className="filters" style={{ borderRadius: '10px 10px 0 0' }}>
            <label className="field"><span className="small muted">Created from</span><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <label className="field"><span className="small muted">Created to</span><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            <label className="field"><span className="small muted">Issue type</span>
              <select className="select" value={f.issue_type} onChange={(e) => setF({ ...f, issue_type: e.target.value })}><option value="">Software &amp; operational</option><option value="software">Software (OzoneBlu) only</option><option value="operational">Operational only</option></select></label>
            <label className="field"><span className="small muted">Department</span>
              <select className="select" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">All in scope</option>{meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          </div>
          <div className="card-head"><h2>{data?.title || list.find((r) => r.key === type)?.title}</h2><span className="muted small" style={{ marginLeft: 'auto' }}>{data ? `${data.rows.length} rows` : ''}</span></div>
          {err && <div className="alert alert-error" style={{ margin: 16 }}>{err}</div>}
          {!data && !err && <Spinner />}
          {data && data.rows.length === 0 && <Empty icon="chart" title="No data for these filters" />}
          {data && data.rows.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: '70vh' }}>
              <table className="data"><thead><tr>{data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{data.rows.map((r, i) => (
                  <tr key={i} style={{ cursor: 'default' }}>{data.columns.map((c) => <td key={c} className={typeof r[c] === 'number' ? 'tabnum' : 'small'}>{r[c] == null ? '—' : isDate(c, r[c]) ? fmtDateTime(r[c]) : String(r[c])}</td>)}</tr>
                ))}</tbody></table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
