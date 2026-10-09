const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;
const root = path.join(__dirname, '..', '..');

module.exports = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT || 4000),
  dbFile: env.DB_FILE || path.join(root, 'data', 'ozone-tracker.db'),
  uploadDir: env.UPLOAD_DIR || path.join(root, 'uploads'),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtTtlHours: Number(env.JWT_TTL_HOURS || 12),
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 10),
  timezone: env.APP_TIMEZONE || 'Asia/Kolkata',
  cookieSecure: env.COOKIE_SECURE === 'true',
  clientDist: path.join(root, 'client', 'dist'),
  smtp: { host: env.SMTP_HOST || '', from: env.SMTP_FROM || 'tickets@ozone.example' },
};
