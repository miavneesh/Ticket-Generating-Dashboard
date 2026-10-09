let TZ = 'Asia/Kolkata';
export const setTimezone = (tz) => { TZ = tz || TZ; };

export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtShort = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short' }) : '—');

export function duration(ms) {
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24 ? `${h % 24}h` : ''}`.trim();
}

export function ago(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  return `${duration(ms)} ago`;
}

export function ticketAge(t) {
  const end = t.closed_at ? new Date(t.closed_at) : new Date();
  return duration(end - new Date(t.created_at));
}

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const slug = (s = '') => s.toLowerCase().replace(/[^a-z]+/g, '-');
