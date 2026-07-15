// Auth routes: signup, login, and the current-user lookup.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Rate-limit the credential endpoints to blunt brute-force / credential-stuffing.
// Keyed by IP; generous enough for real use, tight enough to matter.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Strip the password hash before sending a user to the client.
function publicUser(u) {
  return {
    id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    name: `${u.firstName}${u.lastName ? ' ' + u.lastName : ''}`.trim(),
    initials: (u.firstName[0] + (u.lastName ? u.lastName[0] : '')).toUpperCase(),
    email: u.email,
    rollNumber: u.rollNumber,
    role: u.role,
    program: u.program,
    year: u.year,
    semester: u.semester,
    phone: u.phone,
  };
}

function signToken(user) {
  return jwt.sign({ id: String(user._id) }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// POST /api/auth/login  — accepts email OR roll number in `identifier`.
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/roll number and password are required.' });
    }
    const id = String(identifier).trim();
    const user = await User.findOne({
      $or: [{ email: id.toLowerCase() }, { rollNumber: id }],
    });
    if (!user || !bcrypt.compareSync(String(password), user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials. Please check and try again.' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// The programs the signup form offers; anything else falls back to the default.
const VALID_PROGRAMS = [
  'B.Tech CSE (AIML)', 'B.Tech CSE (AIFT)', 'BBA', 'Hotel Management', 'Design',
  'Fine Arts', 'Architecture', 'Pharmacy', 'Nursing', 'Psychology',
];

// POST /api/auth/signup — creates a new dummy student account.
router.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const { firstName, lastName, email, rollNumber, password, role, program } = req.body || {};
    if (!firstName || !email || !rollNumber || !password) {
      return res.status(400).json({ error: 'First name, email, roll number and password are required.' });
    }
    if (!EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const rollNorm = String(rollNumber).trim();
    const exists = await User.findOne({ $or: [{ email: emailNorm }, { rollNumber: rollNorm }] });
    if (exists) {
      return res.status(409).json({ error: 'An account with this email or roll number already exists.' });
    }
    const chosenProgram = VALID_PROGRAMS.includes(program) ? program : 'B.Tech CSE (AIML)';
    // Self-signup only ever creates a Student. Teacher/Admin accounts require an
    // approval gate and are never created through the public signup form.
    const user = await User.create({
      firstName: String(firstName).trim(),
      lastName: lastName ? String(lastName).trim() : '',
      email: emailNorm,
      rollNumber: rollNorm,
      passwordHash: bcrypt.hashSync(String(password), 10),
      role: 'Student',
      program: chosenProgram,
    });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — the logged-in user.
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// PUT /api/auth/password — change the logged-in user's password.
router.put('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required.' });
    }
    if (!bcrypt.compareSync(String(currentPassword), req.user.passwordHash)) {
      return res.status(401).json({ error: 'Your current password is incorrect.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }
    if (bcrypt.compareSync(String(newPassword), req.user.passwordHash)) {
      return res.status(400).json({ error: 'New password must be different from the current one.' });
    }
    req.user.passwordHash = bcrypt.hashSync(String(newPassword), 10);
    await req.user.save();
    res.json({ ok: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/me — update editable profile fields (roll number stays fixed).
router.put('/me', requireAuth, async (req, res, next) => {
  try {
    const u = req.user;
    const b = req.body || {};
    const pick = (v, fallback) => (v === undefined || v === null ? fallback : v);

    const firstName = String(pick(b.firstName, u.firstName)).trim();
    const lastName = String(pick(b.lastName, u.lastName)).trim();
    const phone = String(pick(b.phone, u.phone)).trim();
    const email = String(pick(b.email, u.email)).trim().toLowerCase();
    const program = String(pick(b.program, u.program)).trim();
    const year = String(pick(b.year, u.year)).trim();
    let semester = Number(pick(b.semester, u.semester));

    if (!firstName) return res.status(400).json({ error: 'First name cannot be empty.' });
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!Number.isInteger(semester) || semester < 1 || semester > 8) semester = u.semester;

    const clash = await User.findOne({ email, _id: { $ne: u._id } });
    if (clash) return res.status(409).json({ error: 'That email is already used by another account.' });

    Object.assign(u, { firstName, lastName, phone, email, program, year, semester });
    await u.save();
    res.json({ user: publicUser(u) });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, publicUser };
