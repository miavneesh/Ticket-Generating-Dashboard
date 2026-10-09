class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Clock can be pinned (used by the demo seeder to replay realistic historical activity)
let pinned = null;
const nowIso = () => pinned || new Date().toISOString();
const setClock = (iso) => { pinned = iso; };
const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const toInt = (v) => (v === undefined || v === null || v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);
const clean = (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v ?? null);
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, nowIso, setClock, parseJson, toInt, clean, asyncH };
