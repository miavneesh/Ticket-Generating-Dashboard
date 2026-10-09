import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../ctx';
import { Icon } from '../icons';
import { Empty, Field, FileDrop, Modal, PriorityBadge, SlaBadge, Spinner, StatusBadge } from '../components/ui';
import { ago, bytes, duration, fmtDate, fmtDateTime, initials } from '../format';

const ACTION_LABEL = (from, to, requesterOnly) => {
  if (to === 'In Progress' && (from === 'Resolved' || from === 'Closed')) return requesterOnly && from === 'Resolved' ? 'Not resolved — reopen' : 'Reopen';
  if (to === 'In Progress' && ['Awaiting Information', 'On Hold', 'Escalated'].includes(from)) return 'Resume work';
  return ({ 'In Progress': 'Start work', 'Awaiting Information': 'Request information', 'On Hold': 'Put on hold', Escalated: 'Escalate', Resolved: 'Resolve',
    Closed: requesterOnly ? 'Confirm & close' : 'Close ticket', Assigned: 'Mark assigned', Submitted: 'Return to triage' })[to] || to;
};
const ACTION_ICON = { 'In Progress': 'arrowRight', 'Awaiting Information': 'info', 'On Hold': 'pause', Escalated: 'alert', Resolved: 'check', Closed: 'lock' };
const PRIMARY = new Set(['Resolved', 'In Progress', 'Closed']);

function StatusModal({ d, to, onClose, onDone }) {
  const t = d.ticket;
  const reopening = (t.status === 'Resolved' || t.status === 'Closed') && to === 'In Progress';
  const needsRemarks = ['Awaiting Information', 'On Hold', 'Escalated'].includes(to) || reopening;
  const [v, setV] = useState({ remarks: '', resolution_summary: t.resolution_summary || '', root_cause: t.root_cause || '', corrective_action: t.corrective_action || '' });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e = {};
    if (needsRemarks && !v.remarks.trim()) e.remarks = 'Required';
    if (to === 'Resolved' && !v.resolution_summary.trim()) e.resolution_summary = 'Resolution details are required';
    if (to === 'Resolved' && !v.root_cause.trim()) e.root_cause = 'Root cause is required';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { onDone(await api.post(`/api/tickets/${t.id}/status`, { status: to, ...v }), `Status changed to ${to}`); }
    catch (x) { setErr({ ...x.details, form: x.message }); setBusy(false); }
  };
  const remarkLabel = { 'Awaiting Information': 'What information do you need?', 'On Hold': 'What is the ticket waiting on?', Escalated: 'Why does this need escalation?' }[to]
    || (reopening ? 'Why is the issue not resolved?' : 'Remarks (optional)');
  return (
    <Modal title={ACTION_LABEL(t.status, to, d.permissions.isRequesterSide && !d.permissions.canWork)} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button></>}>
      <div className="stack">
        <div className="row small"><StatusBadge status={t.status} /><Icon name="arrowRight" size={14} /><StatusBadge status={to} /></div>
        {err.form && <div className="alert alert-error">{err.form}</div>}
        {to === 'Awaiting Information' && <div className="alert alert-info small">Your question is posted to the requester as a visible comment. The SLA clock pauses while waiting, if configured.</div>}
        {to === 'Resolved' && (
          <>
            <Field label="Resolution details" required error={err.resolution_summary}><textarea className="textarea" value={v.resolution_summary} onChange={(e) => setV({ ...v, resolution_summary: e.target.value })} /></Field>
            <Field label="Root cause" required error={err.root_cause}><input className="input" value={v.root_cause} onChange={(e) => setV({ ...v, root_cause: e.target.value })} placeholder="e.g. Outdated price list active for region" /></Field>
            <Field label="Corrective / preventive action"><input className="input" value={v.corrective_action} onChange={(e) => setV({ ...v, corrective_action: e.target.value })} /></Field>
          </>
        )}
        {to === 'Closed' && d.ticket.requires_closure_approval ? <div className="alert alert-warn small">This category requires department-head approval for closure. You are approving it.</div> : null}
        <Field label={remarkLabel} required={needsRemarks} error={err.remarks}><textarea className="textarea" style={{ minHeight: 80 }} value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function AssignModal({ d, onClose, onDone }) {
  const { meta } = useApp();
  const t = d.ticket;
  const staff = meta.staff.filter((s) => s.department_id === t.department_id && s.id !== t.assigned_user_id);
  const [v, setV] = useState({ user_id: '', reason: '' });
  const [err, setErr] = useState('');
  const save = async () => {
    try { onDone(await api.post(`/api/tickets/${t.id}/assign`, v), 'Assignment updated'); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={t.assigned_user_id ? 'Reassign ticket' : 'Assign ticket'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!v.user_id && !d.permissions.canManage}>Save</button></>}>
      <div className="stack">
        {err && <div className="alert alert-error">{err}</div>}
        <Field label={`Team member in ${t.department_name}`}>
          <select className="select" value={v.user_id} onChange={(e) => setV({ ...v, user_id: e.target.value })}>
            <option value="">{d.permissions.canManage && t.assigned_user_id ? '— Unassign —' : 'Select…'}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.role === 'manager' ? ' (Head)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Note (optional)"><input className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
        <p className="hint">To move the ticket to another department, use Transfer instead — the ticket keeps its ID and history.</p>
      </div>
    </Modal>
  );
}

function TransferModal({ d, onClose, onDone }) {
  const { meta } = useApp();
  const t = d.ticket;
  const [v, setV] = useState({ department_id: '', reason: '' });
  const [err, setErr] = useState({});
  const save = async () => {
    try { onDone(await api.post(`/api/tickets/${t.id}/transfer`, v), 'Ticket transferred'); } catch (x) { setErr({ ...x.details, form: x.message }); }
  };
  return (
    <Modal title="Transfer to another department" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Transfer</button></>}>
      <div className="stack">
        {err.form && <div className="alert alert-error">{err.form}</div>}
        <div className="alert alert-info small">The ticket keeps its ID ({t.ticket_no}), attachments, comments and full history. The new department and the requester are notified.</div>
        <Field label="New responsible department" required error={err.department_id}>
          <select className="select" value={v.department_id} onChange={(e) => setV({ ...v, department_id: e.target.value })}>
            <option value="">Select…</option>
            {meta.departments.filter((x) => x.id !== t.department_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Reason for transfer" required error={err.reason}><textarea className="textarea" style={{ minHeight: 80 }} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function EditModal({ d, onClose, onDone }) {
  const { meta } = useApp();
  const t = d.ticket;
  const work = d.permissions.canWork;
  const keys = work
    ? ['subject', 'priority', 'category_id', 'subcategory_id', 'order_stage', 'quote_no', 'sales_order_no', 'survey_ref', 'production_order_no', 'customer_name', 'project_location', 'customer_impact', 'expected_resolution_date']
    : ['quote_no', 'sales_order_no', 'survey_ref', 'production_order_no', 'customer_name', 'project_location', 'customer_impact'];
  const [v, setV] = useState(Object.fromEntries(keys.map((k) => [k, t[k] ?? ''])));
  const [err, setErr] = useState({});
  const cat = meta.categories.find((c) => String(c.id) === String(v.category_id));
  const save = async () => {
    const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => String(x ?? '') !== String(t[k] ?? '')));
    if (!Object.keys(changed).length) return onClose();
    try { onDone(await api.patch(`/api/tickets/${t.id}`, changed), 'Ticket updated'); } catch (x) { setErr({ ...x.details, form: x.message }); }
  };
  const L = (k) => meta.fields.find((f) => f.key === k)?.label || k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Modal title="Edit ticket details" onClose={onClose} width={680}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save changes</button></>}>
      {err.form && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err.form}</div>}
      <div className="grid g2">
        {keys.map((k) => {
          if (k === 'priority') return <Field key={k} label="Priority"><select className="select" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{meta.priorities.map((p) => <option key={p}>{p}</option>)}</select></Field>;
          if (k === 'category_id') return <Field key={k} label="Category"><select className="select" value={v.category_id} onChange={(e) => setV({ ...v, category_id: e.target.value, subcategory_id: '' })}>{meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>;
          if (k === 'subcategory_id') return <Field key={k} label="Subcategory" error={err.subcategory_id}><select className="select" value={v.subcategory_id || ''} onChange={(e) => setV({ ...v, subcategory_id: e.target.value })}><option value="">—</option>{cat?.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>;
          if (k === 'order_stage') return <Field key={k} label="Order stage"><select className="select" value={v.order_stage || ''} onChange={(e) => setV({ ...v, order_stage: e.target.value })}><option value="">—</option>{meta.stages.map((s) => <option key={s}>{s}</option>)}</select></Field>;
          return <Field key={k} label={L(k)} error={err[k]} className={k === 'subject' || k === 'customer_impact' ? 'span-all' : ''}><input className="input" type={k === 'expected_resolution_date' ? 'date' : 'text'} value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>;
        })}
      </div>
      {work && <p className="hint" style={{ marginTop: 10 }}>Changing priority recalculates the SLA targets from the original creation time.</p>}
    </Modal>
  );
}

function Attachments({ list }) {
  if (!list.length) return <p className="muted small">No attachments.</p>;
  return (
    <div className="files">
      {list.map((a) => (
        <a key={a.id} className={`file ${a.is_internal ? 'internal' : ''}`} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">
          <div className="thumb">{a.mime_type.startsWith('image/') ? <img src={`/api/attachments/${a.id}`} alt={a.original_name} loading="lazy" /> : <Icon name="file" size={30} stroke={1.5} />}</div>
          <div className="meta"><b>{a.original_name}</b><div className="muted">{bytes(a.size_bytes)} · {a.user_name}{a.is_internal ? ' · Internal' : ''}</div></div>
        </a>
      ))}
    </div>
  );
}

function Composer({ d, onDone }) {
  const { meta } = useApp();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState([]);
  const [showFiles, setShowFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    if (!body.trim()) { setErr('Write a message first'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.upload(`/api/tickets/${d.ticket.id}/comments`, { body, is_internal: internal }, files);
      setBody(''); setFiles([]); setShowFiles(false);
      onDone(r, internal ? 'Internal note added' : 'Comment posted');
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <div className={`composer ${internal ? 'internal' : ''}`}>
      <label className="sr-only" htmlFor="composer">Message</label>
      <textarea id="composer" className="textarea" value={body} onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? 'Internal note — visible only to Ozone support staff' : d.permissions.canWork ? 'Reply to the requester…' : 'Add a comment or more information…'} />
      {showFiles && <div style={{ padding: '0 10px 10px' }}><FileDrop files={files} setFiles={setFiles} maxMb={meta.settings.max_upload_mb} /></div>}
      <div className="composer-bar">
        {d.permissions.canSeeInternal && (
          <div className="mode-switch" role="group" aria-label="Message visibility">
            <button type="button" className={!internal ? 'on' : ''} onClick={() => setInternal(false)}>Public comment</button>
            <button type="button" className={internal ? 'on int' : ''} onClick={() => setInternal(true)}><Icon name="lock" size={12} /> Internal note</button>
          </div>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowFiles(!showFiles)}><Icon name="clip" size={15} />Attach{files.length ? ` (${files.length})` : ''}</button>
        {err && <span className="field-error">{err}</span>}
        <span className="spacer" />
        <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={busy}>{busy ? 'Sending…' : internal ? 'Add note' : 'Post comment'}</button>
      </div>
    </div>
  );
}

const STAFF_ROLES = new Set(['agent', 'manager', 'admin']);

export default function TicketDetail() {
  const { id } = useParams();
  const { user, toast } = useApp();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('activity');

  const load = useCallback(() => api.get(`/api/tickets/${id}`).then(setD).catch((e) => setErr(e)), [id]);
  useEffect(() => { setD(null); setErr(null); load(); }, [load]);
  const done = (data, msg) => { setD(data); setModal(null); if (msg) toast(msg); };

  if (err) return <Empty icon="lock" title={err.status === 404 ? 'Ticket not found' : 'Could not load ticket'}>{err.status === 404 ? 'It may not exist, or you may not have permission to view it.' : err.message}<div style={{ marginTop: 12 }}><Link className="btn btn-sm" to="/tickets">Back to tickets</Link></div></Empty>;
  if (!d) return <Spinner />;
  const t = d.ticket;
  const p = d.permissions;
  const requesterOnly = p.isRequesterSide && !p.canWork;
  const attachmentsTop = d.attachments.filter((a) => !a.comment_id);
  const attachmentsByComment = d.attachments.reduce((m, a) => { if (a.comment_id) (m[a.comment_id] ||= []).push(a); return m; }, {});
  const overdueResolution = t.sla_resolution_due && !t.resolved_at && !t.sla_paused_at && new Date(t.sla_resolution_due) < new Date();

  return (
    <div>
      <div className="small" style={{ marginBottom: 8 }}><Link to="/tickets"><Icon name="chevronLeft" size={14} /> Tickets</Link></div>
      <div className="detail-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="tid" style={{ fontSize: 15 }}>{t.ticket_no}</span><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /><SlaBadge t={t} />
            {t.reopen_count > 0 && <span className="badge s-escalated">Reopened ×{t.reopen_count}</span>}
            {t.is_software ? <span className="badge s-assigned">Software issue</span> : null}
          </div>
          <h1>{t.subject}</h1>
          <div className="muted small" style={{ marginTop: 4 }}>{t.category_name}{t.subcategory_name ? ` › ${t.subcategory_name}` : ''} · Raised by {t.requester_name} {ago(t.created_at)}</div>
        </div>
      </div>
      {overdueResolution && <div className="alert alert-error" style={{ marginBottom: 14 }}><b>Overdue:</b> resolution target was {fmtDateTime(t.sla_resolution_due)} ({duration(Date.now() - new Date(t.sla_resolution_due))} ago).</div>}
      {t.status === 'Awaiting Information' && p.isRequesterSide && <div className="alert alert-warn" style={{ marginBottom: 14 }}>The team is waiting for information from you. Reply below — the ticket will automatically move back to In Progress.</div>}

      <div className="detail">
        <div className="stack">
          <div className="card">
            {(p.transitions.length > 0 || p.canAssign || p.canTransfer || p.canEdit) && (
              <div className="actions">
                {p.transitions.filter((s) => !['Submitted', 'Assigned'].includes(s)).map((s) => (
                  <button key={s} className={`btn btn-sm ${PRIMARY.has(s) ? 'btn-primary' : ''} ${s === 'Escalated' ? 'btn-danger' : ''}`} onClick={() => setModal({ type: 'status', to: s })}>
                    <Icon name={ACTION_ICON[s] || 'arrowRight'} size={14} />{ACTION_LABEL(t.status, s, requesterOnly)}
                  </button>
                ))}
                {p.canAssign && <button className="btn btn-sm" onClick={() => setModal({ type: 'assign' })}><Icon name="userPlus" size={14} />{t.assigned_user_id ? 'Reassign' : 'Assign'}</button>}
                {p.canTransfer && <button className="btn btn-sm" onClick={() => setModal({ type: 'transfer' })}><Icon name="swap" size={14} />Transfer</button>}
                <span className="spacer" />
                {p.canEdit && <button className="btn btn-sm btn-ghost" onClick={() => setModal({ type: 'edit' })}><Icon name="edit" size={14} />Edit</button>}
              </div>
            )}
            <div className="card-pad">
              <h3 className="muted small" style={{ marginBottom: 6 }}>DESCRIPTION</h3>
              <div className="desc">{t.description}</div>
              {t.customer_impact && <div className="alert alert-warn small" style={{ marginTop: 12 }}><b>Impact:</b> {t.customer_impact}</div>}
            </div>
          </div>

          {t.resolution_summary && (
            <div className="card card-pad resolution">
              <h2 style={{ marginBottom: 10 }}><Icon name="check" size={16} /> Resolution</h2>
              <dl className="kv">
                <dt>Resolution</dt><dd className="desc">{t.resolution_summary}</dd>
                <dt>Root cause</dt><dd>{t.root_cause || '—'}</dd>
                {t.corrective_action && <><dt>Corrective action</dt><dd>{t.corrective_action}</dd></>}
                {t.resolved_at && <><dt>Resolved</dt><dd>{fmtDateTime(t.resolved_at)} · took {duration(new Date(t.resolved_at) - new Date(t.created_at))}</dd></>}
                {t.closed_at && <><dt>Closed</dt><dd>{fmtDateTime(t.closed_at)}{t.closed_by_name ? ` by ${t.closed_by_name}` : ''}</dd></>}
              </dl>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h2>Attachments</h2><span className="muted small">{d.attachments.length}</span></div>
            <div className="card-pad"><Attachments list={attachmentsTop.length ? attachmentsTop : []} />
              {attachmentsTop.length === 0 && d.attachments.length > 0 && <p className="hint">Other files are attached to comments below.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Conversation</h2><span className="muted small">{d.comments.length} message{d.comments.length === 1 ? '' : 's'}</span>
              {p.canSeeInternal && <span className="legend"><span><i style={{ background: 'var(--internal-border)' }} />Internal notes are never shown to requesters or dealers</span></span>}
            </div>
            <div className="card-pad thread">
              {d.comments.length === 0 && <p className="muted small">No comments yet.</p>}
              {d.comments.map((c) => (
                <div key={c.id} className={`msg ${c.is_internal ? 'internal' : ''} ${c.kind === 'info_request' ? 'info' : ''} ${c.user_name === user.name ? 'mine' : ''}`}>
                  <div className="msg-head">
                    <span className="avatar">{initials(c.user_name)}</span><b className="small">{c.user_name}</b>
                    {STAFF_ROLES.has(c.user_role) && <span className="tag tag-staff">Ozone team</span>}
                    {c.user_role === 'dealer' && <span className="tag tag-staff">Dealer</span>}
                    {c.is_internal ? <span className="tag tag-internal"><Icon name="lock" size={10} /> Internal</span> : null}
                    {c.kind === 'info_request' && <span className="tag tag-info">Information requested</span>}
                    <span className="spacer" /><span className="muted small" title={fmtDateTime(c.created_at)}>{ago(c.created_at)}</span>
                  </div>
                  <div className="desc">{c.body}</div>
                  {attachmentsByComment[c.id] && <div style={{ marginTop: 10 }}><Attachments list={attachmentsByComment[c.id]} /></div>}
                </div>
              ))}
              <Composer d={d} onDone={done} />
            </div>
          </div>

          <div className="card">
            <div className="tabs" role="tablist">
              {[['activity', 'Activity timeline'], ['status', 'Status history'], ['assign', 'Assignments & transfers']].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            <div className="card-pad">
              {tab === 'activity' && (
                <ul className="timeline">
                  {d.events.map((e) => (
                    <li key={e.id}><span className={`tdot ${e.event_type}`} />
                      <div className="small">{e.summary}{e.is_internal ? <span className="tag tag-internal" style={{ marginLeft: 6 }}>Internal</span> : null}</div>
                      <div className="sub2">{fmtDateTime(e.created_at)}</div>
                    </li>
                  ))}
                </ul>
              )}
              {tab === 'status' && (
                <div className="table-wrap"><table className="data"><thead><tr><th>When</th><th>From</th><th>To</th><th>By</th><th>Remarks</th></tr></thead>
                  <tbody>{d.status_history.map((h, i) => (
                    <tr key={i} style={{ cursor: 'default' }}><td className="small tabnum">{fmtDateTime(h.created_at)}</td><td>{h.from_status ? <StatusBadge status={h.from_status} /> : '—'}</td><td><StatusBadge status={h.to_status} /></td><td className="small">{h.user_name}</td><td className="small">{h.remarks || ''}</td></tr>
                  ))}</tbody></table></div>
              )}
              {tab === 'assign' && (
                <div className="stack">
                  <div className="table-wrap"><table className="data"><thead><tr><th>When</th><th>Department</th><th>From</th><th>To</th><th>By</th><th>Note</th></tr></thead>
                    <tbody>{d.assignments.length === 0 ? <tr><td colSpan={6} className="muted small">No assignments yet.</td></tr> : d.assignments.map((a, i) => (
                      <tr key={i} style={{ cursor: 'default' }}><td className="small tabnum">{fmtDateTime(a.created_at)}</td><td className="small">{a.department_name}</td><td className="small">{a.from_name || '—'}</td><td className="small">{a.to_name || <span className="muted">Department queue</span>}</td><td className="small">{a.by_name}</td><td className="small">{a.reason || ''}</td></tr>
                    ))}</tbody></table></div>
                  <h3>Department transfers</h3>
                  {d.transfers.length === 0 ? <p className="muted small">This ticket has not been transferred.</p> : (
                    <ul className="timeline">{d.transfers.map((x, i) => (
                      <li key={i}><span className="tdot transferred" /><div className="small"><b>{x.from_department}</b> → <b>{x.to_department}</b> by {x.by_name}</div><div className="small">{x.reason}</div><div className="sub2">{fmtDateTime(x.created_at)}</div></li>
                    ))}</ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="stack">
          <div className="card card-pad">
            <h2 style={{ marginBottom: 12 }}>Details</h2>
            <dl className="kv">
              <dt>Department</dt><dd><b>{t.department_name}</b></dd>
              <dt>Assigned to</dt><dd>{t.assigned_name || <span className="muted">Unassigned</span>}</dd>
              <dt>Requester</dt><dd>{t.requester_name}<div className="sub2">{t.requester_department_name || t.dealer_name || ''}</div></dd>
              {t.dealer_name && <><dt>Dealer</dt><dd>{t.dealer_name}</dd></>}
              {t.customer_name && <><dt>Customer</dt><dd>{t.customer_name}</dd></>}
              {t.project_location && <><dt>Location</dt><dd>{t.project_location}</dd></>}
              {t.order_stage && <><dt>Order stage</dt><dd>{t.order_stage}</dd></>}
              {t.quote_no && <><dt>Quote no.</dt><dd className="tabnum">{t.quote_no}</dd></>}
              {t.sales_order_no && <><dt>Sales order</dt><dd className="tabnum">{t.sales_order_no}</dd></>}
              {t.survey_ref && <><dt>Survey ref.</dt><dd>{t.survey_ref}</dd></>}
              {t.production_order_no && <><dt>Work order</dt><dd>{t.production_order_no}</dd></>}
              {t.expected_resolution_date && <><dt>Expected by</dt><dd>{fmtDate(t.expected_resolution_date)}</dd></>}
              <dt>Created</dt><dd className="tabnum">{fmtDateTime(t.created_at)}</dd>
              <dt>Last updated</dt><dd className="tabnum">{fmtDateTime(t.updated_at)}</dd>
              {t.routed_by && <><dt>Routed by</dt><dd className="small">{{ rule: 'Routing rule', subcategory: 'Subcategory default', category: 'Category default', triage: 'Central triage', manual: 'Chosen by requester' }[t.routed_by]}</dd></>}
            </dl>
          </div>
          <div className="card card-pad sla-box">
            <h2>SLA <span className="muted small" style={{ fontWeight: 400 }}>(configurable targets)</span></h2>
            <div className="sla-line"><span>First response</span><SlaBadge t={t} kind="first" /></div>
            <div className="sub2">Target {fmtDateTime(t.sla_first_response_due)}{t.first_response_at ? ` · responded ${fmtDateTime(t.first_response_at)}` : ''}</div>
            <div className="sla-line"><span>Resolution</span><SlaBadge t={t} /></div>
            <div className="sub2">Target {fmtDateTime(t.sla_resolution_due)}{t.sla_paused_minutes ? ` · paused ${duration(t.sla_paused_minutes * 60000)} in total` : ''}</div>
          </div>
          {d.related.length > 0 && (
            <div className="card card-pad">
              <h2 style={{ marginBottom: 8 }}><Icon name="link" size={15} /> Related tickets</h2>
              {d.related.map((r) => (
                <Link key={r.id} to={`/tickets/${r.ticket_no}`} className="tcard" style={{ display: 'block', padding: '8px 0' }}>
                  <div className="row"><span className="tid">{r.ticket_no}</span><StatusBadge status={r.status} /></div>
                  <div className="small">{r.subject}</div>
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>

      {modal?.type === 'status' && <StatusModal d={d} to={modal.to} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'assign' && <AssignModal d={d} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'transfer' && <TransferModal d={d} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'edit' && <EditModal d={d} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}
