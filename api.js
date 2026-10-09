// Thin fetch wrapper: cookie auth + CSRF header + consistent error objects.
export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details || {}; }
}

async function request(method, url, body, { form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'OzoneTracker' } };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opts); } catch { throw new ApiError(0, 'Cannot reach the server. Check your connection.'); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/')) window.dispatchEvent(new Event('oz:unauthorized'));
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, data, files) => {
    const fd = new FormData();
    fd.append('data', JSON.stringify(data || {}));
    if (data?.is_internal !== undefined) fd.append('is_internal', String(!!data.is_internal));
    (files || []).forEach((f) => fd.append('files', f));
    return request('POST', url, undefined, { form: fd });
  },
};

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
