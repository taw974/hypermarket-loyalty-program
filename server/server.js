'use strict';
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { getSettings, one } = require('./db');
const { HttpError } = require('./util');
const { attachUser, csrfGuard } = require('./auth');
const { ensureBase, seedDemo, refreshDemoDates } = require('./seed');
const core = require('./routes/core');
const ops = require('./routes/ops');
const admin = require('./routes/admin');
const { publicRouter, apiV1 } = require('./routes/public');

const PORT = Number(process.env.PORT) || 8974;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------- First run: base data + a living demo ----------
ensureBase();
if (getSettings().demo_mode && !one('SELECT COUNT(*) AS n FROM members').n) {
  const r = seedDemo();
  console.log(`  Demo data created: ${r.members} members, ${r.transactions} transactions`);
}
function keepDemoFresh() {
  if (!getSettings().demo_mode) return;
  const days = refreshDemoDates();
  if (days) console.log(`  Demo data moved forward ${days} day(s) so today's dashboard stays alive`);
}
keepDemoFresh();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self' data:", "connect-src 'self'", "media-src 'self' blob:", "worker-src 'self' blob:",
    "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '4mb' }));

// Public endpoints (no session)
app.use('/api/public', publicRouter);
app.use('/api/v1', apiV1);

// Staff API
app.use('/api', attachUser, csrfGuard);
app.use('/api', core.router);
app.use('/api', ops.router);
app.use('/api', admin.router);
app.use('/api', (req, res, next) => next(new HttpError(404, 'API endpoint not found')));

// Static frontend
app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  setHeaders(res, file) {
    if (file.includes(`${path.sep}vendor${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('/m/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'm.html')));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html')));

// Errors → JSON
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON body');
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return;
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : err.message, ...(err.extra || {}) });
});

const server = app.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  const line = '─'.repeat(58);
  console.log(`\n  ${line}\n   👑  ROYAL LOYALTY  ·  ${getSettings().program_tagline}\n  ${line}`);
  console.log(`   This computer : http://localhost:${PORT}`);
  for (const ip of lan) console.log(`   Other devices : http://${ip}:${PORT}`);
  console.log(`   Mode          : ${getSettings().demo_mode ? 'DEMO (sample data loaded)' : 'LIVE'}`);
  console.log(`  ${line}\n   Keep this window open while the system is in use.\n`);
  if (process.env.RL_OPEN_BROWSER && process.platform === 'win32') {
    require('node:child_process').spawn('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { detached: true, stdio: 'ignore' }).unref();
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — the Royal Loyalty server is probably already running.`);
    console.error(`  Open http://localhost:${PORT} in the browser, or close the other server window first.\n`);
    process.exit(1);
  }
  throw err;
});

// Nightly safety net: automatic database backup every 24h (and 1 minute after start).
const autoBackup = () => admin.makeBackup('auto').catch((e) => console.error('Backup failed:', e.message));
setTimeout(autoBackup, 60 * 1000).unref();
setInterval(autoBackup, 24 * 60 * 60 * 1000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n  Shutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
