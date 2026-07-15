// CU-Connect backend. Serves the frontend HTML in local dev and exposes the
// /api routes behind JWT auth + RBAC, backed by MongoDB and Socket.IO.
const express = require('express');
const http = require('http');
const cors = require('cors');
const {
  PORT, FRONTEND_DIR, CORS_ORIGINS, IDE_ENABLED, isProduction,
} = require('./config');
const { connect } = require('./db/database');
const seed = require('./db/seed');
const realtime = require('./lib/realtime');
const { router: authRouter } = require('./routes/auth');
const dataRouter = require('./routes/data');
const leaveRouter = require('./routes/leave');
const executeRouter = require('./routes/execute');
const teacherRouter = require('./routes/teacher');

async function main() {
  // Connect to MongoDB before anything touches a model.
  await connect();
  console.log('Connected to MongoDB.');

  // Seed on boot (no-op if data already exists).
  const { seeded } = await seed();
  if (seeded) console.log('Seeded the database.');

  const app = express();
  app.set('trust proxy', 1); // correct client IPs behind Render/Railway proxies (rate limiting)

  // CORS. When CORS_ORIGINS is set (split frontend/backend deploy), restrict to
  // that allowlist; otherwise allow same-origin/local dev.
  if (CORS_ORIGINS.length) {
    app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
  } else {
    app.use(cors());
  }

  app.use(express.json({ limit: '1mb' }));

  // Lightweight health check for the host's uptime probe.
  app.get('/healthz', (_req, res) => res.json({ ok: true, ide: IDE_ENABLED }));

  // API
  app.use('/api/auth', authRouter);
  app.use('/api', dataRouter);
  app.use('/api', leaveRouter);
  app.use('/api/teacher', teacherRouter);
  // The IDE runner is unsandboxed — only mount it when explicitly enabled.
  if (IDE_ENABLED) {
    app.use('/api', executeRouter);
    console.log('Online IDE ENABLED (unsandboxed local runner).');
  } else {
    console.log('Online IDE disabled (set IDE_ENABLED=true to enable in dev).');
  }

  // Serve the frontend so http://localhost:PORT/login.html etc. just work.
  // In a split deploy the frontend lives on Vercel, so this is a dev convenience.
  app.use(express.static(FRONTEND_DIR));
  app.get('/', (_req, res) => res.redirect('/index.html'));

  // Central error handler — never leak stack traces to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  // Wrap Express in an explicit HTTP server so Socket.IO can share the port.
  const server = http.createServer(app);
  realtime.init(server);

  server.listen(PORT, () => {
    console.log(`CU-Connect backend running at http://localhost:${PORT}`);
    if (!isProduction) console.log(`Serving frontend from: ${FRONTEND_DIR}`);
    console.log('Real-time sync (Socket.IO) enabled.');
    console.log('Student demo → pallakshi@chitkara.edu.in / password123');
    console.log('Teacher demo → rajesh@chitkara.edu.in / password123');
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
