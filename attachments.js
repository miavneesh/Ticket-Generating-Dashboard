const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { getDb } = require('../db');
const { HttpError, nowIso } = require('./util');
const P = require('./permissions');
const { addEvent } = require('./ticketService');
const { audit } = require('./audit');

// Allowed file types: extension → accepted MIME types
const ALLOWED = {
  '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.gif': ['image/gif'], '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.dwg': ['application/acad', 'image/vnd.dwg', 'application/octet-stream', 'image/x-dwg'],
  '.dxf': ['application/dxf', 'image/vnd.dxf', 'application/octet-stream'],
  '.doc': ['application/msword'], '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'], '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain'], '.txt': ['text/plain'],
};
// Magic-byte checks for the types we can render inline
const MAGIC = { '.png': [0x89, 0x50, 0x4e, 0x47], '.jpg': [0xff, 0xd8, 0xff], '.jpeg': [0xff, 0xd8, 0xff], '.gif': [0x47, 0x49, 0x46], '.pdf': [0x25, 0x50, 0x44, 0x46] };

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase()),
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED[ext] || !ALLOWED[ext].includes(file.mimetype)) return cb(new HttpError(400, `File type not allowed: ${file.originalname}`));
    cb(null, true);
  },
});

function verifyMagic(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const sig = MAGIC[ext];
  if (!sig) return true;
  const fd = fs.openSync(file.path, 'r');
  const buf = Buffer.alloc(sig.length);
  fs.readSync(fd, buf, 0, sig.length, 0);
  fs.closeSync(fd);
  return sig.every((b, i) => buf[i] === b);
}

function discard(files) { for (const f of files || []) fs.rm(f.path, { force: true }, () => {}); }

function saveAttachments(user, t, files, { internal = false, commentId = null, at } = {}) {
  if (!files?.length) return [];
  if (internal && !P.canSeeInternal(user, t)) { discard(files); throw new HttpError(403, 'Only Ozone staff can add internal attachments'); }
  for (const f of files) if (!verifyMagic(f)) { discard(files); throw new HttpError(400, `File content does not match its type: ${f.originalname}`); }
  const now = at || nowIso();
  const ins = getDb().prepare('INSERT INTO ticket_attachments (ticket_id, comment_id, user_id, original_name, stored_name, mime_type, size_bytes, is_internal, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const ids = files.map((f) => Number(ins.run(t.id, commentId, user.id, path.basename(f.originalname).slice(0, 200), f.filename, f.mimetype, f.size, internal ? 1 : 0, now).lastInsertRowid));
  addEvent(t.id, user.id, 'attachment', `${user.name} attached ${files.map((f) => f.originalname).join(', ')}`, { at: now, internal });
  audit(user.id, 'ticket.attach', 'ticket', t.ticket_no, { files: files.map((f) => f.originalname), internal });
  return ids;
}

module.exports = { upload, saveAttachments, discard, ALLOWED };
