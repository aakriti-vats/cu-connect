// Central config. Loads environment variables from a local .env in development
// (in production the host — Render/Railway — injects them directly).
require('dotenv').config();
const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// --- JWT secret -----------------------------------------------------------
// Production MUST provide a real secret via env. We refuse to boot with the
// insecure dev default in production so a forgeable-token deploy is impossible.
const DEV_JWT_SECRET = 'cu-connect-dev-secret-change-me';
const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;
if (isProduction && JWT_SECRET === DEV_JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. Refusing to start in production with the insecure dev default. ' +
    'Set a strong JWT_SECRET environment variable.'
  );
}

// --- CORS origins ---------------------------------------------------------
// When the frontend (Vercel) and backend (Render) live on different origins,
// list the allowed frontend origins here via CORS_ORIGINS (comma-separated).
// Empty in local dev where the backend also serves the frontend (same-origin).
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// --- Code IDE feature flag ------------------------------------------------
// The local spawn-based runner is unsandboxed, so it must never face the
// internet. Default: enabled in dev, disabled in production. Flip on only when
// a real sandbox (Judge0/Docker) is wired up and IDE_ENABLED=true is set.
const IDE_ENABLED = process.env.IDE_ENABLED
  ? process.env.IDE_ENABLED === 'true'
  : !isProduction;

module.exports = {
  NODE_ENV,
  isProduction,
  PORT: process.env.PORT || 4000,
  JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  // MongoDB connection string (MongoDB Atlas in production).
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cu-connect',
  CORS_ORIGINS,
  IDE_ENABLED,
  // Minimum attendance policy used by the bunk calculator (percent).
  MIN_ATTENDANCE: 75,
  // Absolute path to the frontend the server statically serves in local dev.
  FRONTEND_DIR: path.join(__dirname, '..', 'Frontend', 'Landing Page'),
};
