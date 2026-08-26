require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { requireAuth } = require('./middleware/auth');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(require('compression')());
app.use(express.json({ limit: '1mb' }));

// Public
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth'));

// Protected API
app.use('/api', requireAuth);
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/daily', require('./routes/daily'));
app.use('/api/members', require('./routes/members'));
app.use('/api/targets', require('./routes/targets'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/push', require('./routes/push'));

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve built client (production / Railway)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
// Vite emits content-hashed files under /assets — safe to cache for a year; index.html must always be re-validated
app.use('/assets', express.static(path.join(clientDist, 'assets'), { maxAge: '1y', immutable: true }));
app.use(
  express.static(clientDist, {
    maxAge: '1h',
    // PWA plumbing must never be served stale, otherwise phones keep an old service worker / manifest for an hour
    setHeaders: (res, filePath) => {
      if (/(?:sw\.js|manifest\.webmanifest|offline\.html)$/.test(filePath)) res.set('Cache-Control', 'no-cache');
    },
  })
);
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`WorkPA server listening on http://localhost:${PORT}`);
    const azdo = require('./services/azdo');
    console.log(azdo.enabled() ? `[azdo] sync enabled -> ${azdo.config().orgUrl}/${azdo.config().project}` : '[azdo] sync not configured (set AZDO_ORG_URL, AZDO_PROJECT, AZDO_PAT)');
    startScheduler();
  });
});
