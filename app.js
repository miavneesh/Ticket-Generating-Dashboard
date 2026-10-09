const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { ZodError } = require('zod');
const config = require('./config');
const { requireAuth, requireRole, csrfGuard } = require('./lib/auth');
const { HttpError } = require('./lib/util');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'], scriptSrc: ["'self'"], frameSrc: ["'self'"], objectSrc: ["'none'"],
      },
    },
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString(), demo: process.env.DEMO_MODE !== 'false' }));
  app.use('/api', csrfGuard);
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/tickets', requireAuth, require('./routes/tickets'));
  app.use('/api/attachments', requireAuth, require('./routes/tickets').files);
  app.use('/api/admin', requireAuth, requireRole('admin'), require('./routes/admin'));
  app.use('/api', requireAuth, require('./routes/analytics'));
  app.use('/api', requireAuth, require('./routes/meta'));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // Serve the built React app
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ZodError) {
      const details = {};
      for (const i of err.issues) details[i.path.join('.') || 'form'] = i.message;
      return res.status(400).json({ error: Object.values(details)[0] || 'Invalid input', details });
    }
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${config.maxUploadMb} MB)` : err.message;
      return res.status(400).json({ error: msg });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

module.exports = { createApp };
