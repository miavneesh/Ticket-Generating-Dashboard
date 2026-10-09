// Online, consistent backup of the SQLite database + attachments manifest.
// Usage: npm run backup   (writes to ./backups/<timestamp>/). Schedule daily via cron / Task Scheduler.
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { getDb } = require('../src/db');

(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, '..', '..', 'backups', stamp);
  fs.mkdirSync(dir, { recursive: true });
  await getDb().backup(path.join(dir, 'ozone-tracker.db'));
  fs.cpSync(config.uploadDir, path.join(dir, 'uploads'), { recursive: true });
  console.log(`Backup written to ${dir}`);
})();
