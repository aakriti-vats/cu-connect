// Data routes for the in-scope features: dashboard summary, attendance
// (with bunk calculator) and results (SGPA/CGPA). All require a valid token.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getAttendance, getAttendanceHistory, getResults } = require('../lib/academics');
const { MIN_ATTENDANCE } = require('../config');
const { Announcement } = require('../models');

const router = express.Router();
router.use(requireAuth);

// GET /api/announcements — teacher announcements targeted at this student's
// program (and either their semester or a program-wide/all-semester post).
router.get('/announcements', async (req, res, next) => {
  try {
    const rows = await Announcement.find({
      program: req.user.program,
      $or: [{ semester: null }, { semester: req.user.semester }],
    })
      .sort({ _id: -1 })
      .populate('authorId', 'firstName lastName')
      .lean();
    const announcements = rows.map((a) => {
      const u = a.authorId || {};
      const author = `${u.firstName || ''}${u.lastName ? ' ' + u.lastName : ''}`.trim();
      return {
        id: String(a._id),
        title: a.title,
        body: a.body,
        type: a.type,
        semester: a.semester,
        createdAt: a.createdAt,
        author,
      };
    });
    res.json({ announcements });
  } catch (err) {
    next(err);
  }
});

// GET /api/attendance?policy=75&semester=4  (semester optional; omit for all-up)
router.get('/attendance', async (req, res, next) => {
  try {
    const policy = Number(req.query.policy) || MIN_ATTENDANCE;
    const semester = req.query.semester ? Number(req.query.semester) : null;
    res.json(await getAttendance(req.user.id, policy, semester));
  } catch (err) {
    next(err);
  }
});

// GET /api/attendance/history?policy=75 — per-semester attendance summary.
router.get('/attendance/history', async (req, res, next) => {
  try {
    const policy = Number(req.query.policy) || MIN_ATTENDANCE;
    res.json({ policy, history: await getAttendanceHistory(req.user.id, policy) });
  } catch (err) {
    next(err);
  }
});

// GET /api/results
router.get('/results', async (req, res, next) => {
  try {
    res.json(await getResults(req.user.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard — the headline numbers shown on the dashboard cards.
router.get('/dashboard', async (req, res, next) => {
  try {
    // Headline attendance reflects the student's current semester.
    const attendance = await getAttendance(req.user.id, MIN_ATTENDANCE, req.user.semester);
    const results = await getResults(req.user.id);
    res.json({
      attendance: {
        percentage: attendance.overall.percentage,
        safeBunks: attendance.overall.safeBunks,
        subjectCount: attendance.subjects.length,
      },
      cgpa: results.cgpa,
      performanceBand: results.performanceBand,
      isExcellent: results.isExcellent,
      currentSemester: req.user.semester,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
