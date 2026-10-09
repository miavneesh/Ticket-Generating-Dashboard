const config = require('./config');
const { getDb } = require('./db');
const { createApp } = require('./app');

if (config.env === 'production' && config.jwtSecret === 'dev-only-secret-change-me') {
  console.error('Refusing to start: set JWT_SECRET in production.');
  process.exit(1);
}
getDb(); // run migrations
createApp().listen(config.port, () => console.log(`Ozone Issue Tracker running on http://localhost:${config.port}`));
