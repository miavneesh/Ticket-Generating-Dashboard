import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api';
import { useApp } from '../ctx';
import { Icon } from '../icons';
import { Field, FileDrop, useClickOutside } from '../components/ui';
import { fmtDateTime } from '../format';

const EMPTY = { subject: '', description: '', category_id: '', subcategory_id: '', priority: 'Medium', department_id: '', assigned_user_id: '',
  dealer_id: '', customer_id: '', customer_name: '', project_location: '', quote_no: '', sales_order_no: '', survey_ref: '', production_order_no: '',
  order_stage: '', customer_impact: '', expected_resolution_date: '', related_ticket_no: '' };

const PRIORITY_HELP = { Critical: 'Work stopped / customer-facing failure', High: 'Order or customer at risk', Medium: 'Normal business issue', Low: 'Query or minor issue' };

/** Text input with suggestions from OzoneBlu imported references */
function RefInput({ value, onChange, onPick, placeholder, id }) {
  const [opts, setOpts] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useClickOutside(ref, () => setOpen(false));
  useEffect(() => {
    if (!value || value.length < 3) { setOpts([]); return undefined; }
    const t = setTimeout(() => api.get(`/api/ozoneblu/lookup${qs({ q: value })}`).then((r) => { setOpts(r); }).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <input id={id} className="input" value={value} placeholder={placeholder} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} autoComplete="off" />
      {open && opts.length > 0 && (
        <div className="suggest" role="listbox">
          <div className="small muted" style={{ padding: '6px 12px' }}>Matches from OzoneBlu reference import</div>
          {opts.map((o, i) => (
            <button type="button" key={i} onClick={() => { onPick(o); setOpen(false); }}>
              <b className="small">{o.quote_no || '—'}</b>{o.sales_order_no && <span className="small"> · {o.sales_order_no}</span>}
              <div className="sub2">{o.customer_name}{o.order_stage ? ` · ${o.order_stage}` : ''}{o.dealer ? ` · ${o.dealer.name}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerInput({ value, onChange, onPick }) {
  const [opts, setOpts] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useClickOutside(ref, () => setOpen(false));
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => api.get(`/api/lookup/customers${qs({ q: value })}`).then(setOpts).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [value, open]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <input className="input" value={value} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search or type customer / project name" autoComplete="off" />
      {open && opts.length > 0 && (
        <div className="suggest">
          {opts.map((c) => <button type="button" key={c.id} onClick={() => { onPick(c); setOpen(false); }}><b className="small">{c.name}</b><div className="sub2">{c.location}</div></button>)}
        </div>
      )}
    </div>
  );
}

export default function CreateTicket() {
  const { meta, user, can, toast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ ...EMPTY, dealer_id: user.dealer_id || '' });
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  const cat = meta.categories.find((c) => String(c.id) === String(f.category_id));
  const visible = new Set(cat?.visible_fields || []);
  const required = new Set(cat?.required_fields || []);
  const show = (k) => visible.has(k) || required.has(k);
  const staffCanAssign = can.staff;
  const targetDept = f.department_id || preview?.department_id;
  const assignees = useMemo(() => meta.staff.filter((s) => String(s.department_id) === String(targetDept)), [meta.staff, targetDept]);
  const canPickAssignee = can.admin || (can.staff && String(user.department_id) === String(targetDept));

  useEffect(() => {
    if (!f.category_id) { setPreview(null); return; }
    api.get(`/api/route-preview${qs({ category_id: f.category_id, subcategory_id: f.subcategory_id, order_stage: f.order_stage, priority: f.priority })}`).then(setPreview).catch(() => setPreview(null));
  }, [f.category_id, f.subcategory_id, f.order_stage, f.priority]);

  const pickRef = (o) => setF((x) => ({
    ...x, quote_no: o.quote_no || x.quote_no, sales_order_no: o.sales_order_no || x.sales_order_no, customer_name: o.customer_name || x.customer_name,
    customer_id: '', project_location: o.project_location || x.project_location, order_stage: o.order_stage || x.order_stage,
    dealer_id: user.role === 'dealer' ? x.dealer_id : o.dealer?.id || x.dealer_id,
  }));

  const validate = () => {
    const e = {};
    if (!f.category_id) e.category_id = 'Select an issue category';
    if (f.subject.trim().length < 5) e.subject = 'Subject must be at least 5 characters';
    if (f.description.trim().length < 10) e.description = 'Please describe the problem (at least 10 characters)';
    for (const k of required) if (!f[k]) e[k] = 'Required for this category';
    const big = files.find((x) => x.size > meta.settings.max_upload_mb * 1048576);
    if (big) e.files = `${big.name} is larger than ${meta.settings.max_upload_mb} MB`;
    return e;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) { setFormErr('Please fix the highlighted fields.'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setBusy(true); setFormErr('');
    const payload = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== '' && (k in EMPTY)));
    // Only send fields relevant to this category
    for (const k of ['dealer_id', 'customer_name', 'project_location', 'quote_no', 'sales_order_no', 'survey_ref', 'production_order_no', 'order_stage', 'customer_impact', 'expected_resolution_date', 'related_ticket_no']) if (!show(k)) delete payload[k];
    if (!show('customer_name')) delete payload.customer_id;
    try {
      const r = await api.upload('/api/tickets', payload, files);
      toast(`Ticket ${r.ticket_no} created`);
      nav(`/tickets/${r.ticket_no}`);
    } catch (x) {
      setErrors(x.details || {}); setFormErr(x.message); setBusy(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const L = (k) => meta.fields.find((x) => x.key === k)?.label;
  const textField = (k, props = {}) => show(k) && (
    <Field label={L(k)} required={required.has(k)} error={errors[k]} {...props.field}>
      <input className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} {...props.input} />
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate>
      <div className="page-head">
        <div><h1>Create ticket</h1><p>Describe the problem once — it will be routed to the responsible team and tracked until closure.</p></div>
      </div>
      {formErr && <div className="alert alert-error" role="alert" style={{ marginBottom: 14 }}>{formErr}</div>}
      <div className="detail">
        <div className="card">
          <section className="form-section">
            <h2><span className="step-n">1</span>What is the issue about?</h2>
            <div className="cat-grid" role="radiogroup" aria-label="Issue category">
              {meta.categories.map((c) => {
                const d = meta.departments.find((x) => x.id === c.department_id);
                return (
                  <button type="button" key={c.id} role="radio" aria-checked={String(f.category_id) === String(c.id)} className={`cat-btn ${String(f.category_id) === String(c.id) ? 'on' : ''}`}
                    onClick={() => { set('category_id', c.id); set('subcategory_id', ''); }}>
                    <b>{c.name}</b><span>{d ? d.name : 'Central triage'}</span>
                  </button>
                );
              })}
            </div>
            {errors.category_id && <div className="field-error" style={{ marginTop: 6 }}>{errors.category_id}</div>}
            {cat && (
              <div className="grid g2" style={{ marginTop: 14 }}>
                <Field label="Subcategory" error={errors.subcategory_id}>
                  <select className="select" value={f.subcategory_id} onChange={(e) => set('subcategory_id', e.target.value)}>
                    <option value="">Select subcategory…</option>
                    {cat.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Priority" required hint={PRIORITY_HELP[f.priority]}>
                  <select className="select" value={f.priority} onChange={(e) => set('priority', e.target.value)}>
                    {meta.priorities.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </Field>
              </div>
            )}
          </section>

          <section className="form-section">
            <h2><span className="step-n">2</span>Describe the problem</h2>
            <div className="stack">
              <Field label="Subject" required error={errors.subject}>
                <input className="input" value={f.subject} maxLength={200} onChange={(e) => set('subject', e.target.value)} placeholder="e.g. Sliding door series missing from quote product list" />
              </Field>
              <Field label="Detailed description" required error={errors.description} hint="What happened, where in OzoneBlu or on site, what you expected, and any error messages.">
                <textarea className="textarea" value={f.description} onChange={(e) => set('description', e.target.value)} rows={6} />
              </Field>
              {show('customer_impact') && (
                <Field label={L('customer_impact')} required={required.has('customer_impact')} error={errors.customer_impact}>
                  <input className="input" value={f.customer_impact} onChange={(e) => set('customer_impact', e.target.value)} placeholder="e.g. Installation team idle at site, customer move-in date at risk" />
                </Field>
              )}
            </div>
          </section>

          {cat && (
            <section className="form-section">
              <h2><span className="step-n">3</span>Order &amp; customer references</h2>
              <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>Fields shown depend on the category. Start typing a quote or order number to pull details from the OzoneBlu reference list.</p>
              <div className="grid g2">
                {show('quote_no') && (
                  <Field label={L('quote_no')} required={required.has('quote_no')} error={errors.quote_no}>
                    <RefInput value={f.quote_no} onChange={(v) => set('quote_no', v)} onPick={pickRef} placeholder="QT/GGN/26-27/0412" />
                  </Field>
                )}
                {show('sales_order_no') && (
                  <Field label={L('sales_order_no')} required={required.has('sales_order_no')} error={errors.sales_order_no}>
                    <RefInput value={f.sales_order_no} onChange={(v) => set('sales_order_no', v)} onPick={pickRef} placeholder="SO/26-27/1187" />
                  </Field>
                )}
                {textField('survey_ref', { input: { placeholder: 'SV-26-0218' } })}
                {textField('production_order_no', { input: { placeholder: 'WO-26-0934' } })}
                {show('order_stage') && (
                  <Field label={L('order_stage')} required={required.has('order_stage')} error={errors.order_stage}>
                    <select className="select" value={f.order_stage} onChange={(e) => set('order_stage', e.target.value)}>
                      <option value="">Select stage…</option>
                      {meta.stages.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                )}
                {show('dealer_id') && (
                  <Field label={L('dealer_id')} required={required.has('dealer_id')} error={errors.dealer_id}>
                    {user.role === 'dealer'
                      ? <input className="input" value={user.dealer_name} disabled />
                      : (
                        <select className="select" value={f.dealer_id} onChange={(e) => set('dealer_id', e.target.value)}>
                          <option value="">Not applicable / direct customer</option>
                          {meta.dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      )}
                  </Field>
                )}
                {show('customer_name') && (
                  <Field label={L('customer_name')} required={required.has('customer_name')} error={errors.customer_name || errors.customer_id}>
                    <CustomerInput value={f.customer_name} onChange={(v) => { set('customer_name', v); set('customer_id', ''); }}
                      onPick={(c) => setF((x) => ({ ...x, customer_id: c.id, customer_name: c.name, project_location: x.project_location || c.location || '', dealer_id: user.role === 'dealer' ? x.dealer_id : c.dealer_id || x.dealer_id }))} />
                  </Field>
                )}
                {textField('project_location', { input: { placeholder: 'Site address / city' } })}
                {textField('expected_resolution_date', { input: { type: 'date' } })}
                {textField('related_ticket_no', { input: { placeholder: 'OZ-2026-00012' } })}
              </div>
            </section>
          )}

          <section className="form-section">
            <h2><span className="step-n">{cat ? 4 : 3}</span>Attachments</h2>
            <FileDrop files={files} setFiles={setFiles} maxMb={meta.settings.max_upload_mb} />
            {errors.files && <div className="field-error">{errors.files}</div>}
          </section>
        </div>

        <aside className="stack" style={{ position: 'sticky', top: 76 }}>
          <div className="card card-pad stack">
            <h2>Routing</h2>
            {preview ? (
              <div className="route-hint"><Icon name="arrowRight" />
                <div>Will go to <b>{f.department_id ? meta.departments.find((d) => String(d.id) === String(f.department_id))?.name : preview.department_name}</b>
                  <div className="sub2">{f.department_id ? 'Department chosen manually' : preview.is_triage ? 'No automatic rule — central triage will assign it' : `Automatic routing (${preview.routed_by})`}</div>
                </div>
              </div>
            ) : <div className="hint">Pick a category to see where the ticket will be routed.</div>}
            <Field label="Responsible department" hint="Leave on automatic unless you are sure.">
              <select className="select" value={f.department_id} onChange={(e) => { set('department_id', e.target.value); set('assigned_user_id', ''); }}>
                <option value="">Automatic (recommended)</option>
                {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            {staffCanAssign && (
              <Field label="Assign to" error={errors.assigned_user_id} hint={canPickAssignee ? 'Optional' : 'Only the responsible department can assign'}>
                <select className="select" value={f.assigned_user_id} onChange={(e) => set('assigned_user_id', e.target.value)} disabled={!canPickAssignee}>
                  <option value="">Department will assign</option>
                  {assignees.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="card card-pad">
            <h2 style={{ marginBottom: 10 }}>Requester</h2>
            <dl className="kv">
              <dt>Name</dt><dd>{user.name}</dd>
              <dt>Role</dt><dd>{meta.roleLabels[user.role]}</dd>
              <dt>{user.dealer_name ? 'Dealer' : 'Department'}</dt><dd>{user.dealer_name || user.department_name || '—'}</dd>
              <dt>Date &amp; time</dt><dd>{fmtDateTime(new Date().toISOString())}</dd>
              <dt>Ticket ID</dt><dd className="muted">Generated on submit (OZ-YYYY-NNNNN)</dd>
            </dl>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', padding: 12 }} disabled={busy}>{busy ? 'Submitting…' : 'Submit ticket'}</button>
        </aside>
      </div>
    </form>
  );
}
