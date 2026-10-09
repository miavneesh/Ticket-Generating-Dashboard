import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { slug, duration, fmtDateTime, bytes } from '../format';

export const Spinner = () => <div className="loading"><div className="spinner" aria-label="Loading" /></div>;

export function Empty({ icon = 'inbox', title, children }) {
  return <div className="empty"><Icon name={icon} size={34} stroke={1.5} /><b>{title}</b>{children}</div>;
}

export function StatusBadge({ status }) {
  return <span className={`badge s-${slug(status)}`}><span className="pip" />{status}</span>;
}

const PRIO_BARS = { Critical: 4, High: 3, Medium: 2, Low: 1 };
export function PriorityBadge({ priority }) {
  const n = PRIO_BARS[priority] || 1;
  return (
    <span className={`prio p-${slug(priority)}`}>
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <rect key={i} x={i * 3.6} y={9 - i * 3} width="2.6" height={3 + i * 3} rx="1" fill="currentColor" opacity={i < n ? 1 : 0.2} />)}
      </svg>
      {priority}
    </span>
  );
}

/** SLA indicator for resolution target. Icon + label so it never relies on colour alone. */
export function SlaBadge({ t, kind = 'resolution' }) {
  const due = kind === 'resolution' ? t.sla_resolution_due : t.sla_first_response_due;
  const done = kind === 'resolution' ? t.resolved_at : t.first_response_at;
  if (!due) return <span className="sla sla-na">No SLA</span>;
  if (done) {
    const met = new Date(done) <= new Date(due);
    return <span className={`sla ${met ? 'sla-ok' : 'sla-breach'}`}><Icon name={met ? 'check' : 'alert'} size={13} />{met ? 'Met' : 'Missed'}</span>;
  }
  if (kind === 'resolution' && t.sla_paused_at) return <span className="sla sla-paused"><Icon name="pause" size={13} />Paused</span>;
  if (['Resolved', 'Closed'].includes(t.status)) return <span className="sla sla-na">—</span>;
  const left = new Date(due) - Date.now();
  if (left < 0) return <span className="sla sla-breach" title={`Due ${fmtDateTime(due)}`}><Icon name="alert" size={13} />Overdue {duration(-left)}</span>;
  const warn = left < 4 * 3600000;
  return <span className={`sla ${warn ? 'sla-warn' : 'sla-ok'}`} title={`Due ${fmtDateTime(due)}`}><Icon name="clock" size={13} />{duration(left)} left</span>;
}

export function Field({ label, required, error, hint, children, className = '' }) {
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && <label>{label}{required && <span className="req" aria-hidden="true">*</span>}</label>}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, width }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined}>
        <div className="modal-head"><h2>{title}</h2><span className="spacer" /><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function FileDrop({ files, setFiles, maxMb = 10 }) {
  const [over, setOver] = useState(false);
  const ref = useRef();
  const add = (list) => setFiles((f) => [...f, ...Array.from(list)].slice(0, 10));
  return (
    <div>
      <div className={`drop ${over ? 'over' : ''}`} onClick={() => ref.current.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }} role="button" tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current.click()}>
        <Icon name="upload" /> <div><b>Drop files here</b> or click to browse</div>
        <div className="hint">Screenshots, PDFs, drawings (DWG/DXF), photos, Office files · max {maxMb} MB each · up to 10 files</div>
        <input ref={ref} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }}
          accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.csv,.txt" />
      </div>
      {files.length > 0 && (
        <div className="file-pills">
          {files.map((f, i) => (
            <span className="file-pill" key={i}>
              <Icon name="file" size={13} />{f.name} <span className="muted">{bytes(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function useClickOutside(ref, fn) {
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && fn();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, fn]);
}
