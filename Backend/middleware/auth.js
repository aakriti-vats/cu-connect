// Verifies the JWT Bearer token and attaches the current user to req.user.
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { User } = require('../models');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authentication token.' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  try {
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'User no longer exists.' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Gate a route to one or more roles. Must run after requireAuth so req.user
// is populated. Re-checks the role server-side on every request (never trust
// the client) per the project's non-negotiable authorization rule.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
