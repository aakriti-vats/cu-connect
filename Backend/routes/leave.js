// Leave Management routes. Students apply for Gate Pass / ML / DL leaves; every
// request is dual-routed to its approver AND a central admin audit store, and
// the status pipeline (Pending -> Under Review -> Approved/Rejected) is recorded
// as an append-only audit trail (embedded `audit` array). All routes require a
// valid token.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { Leave } = require('../models');

const router = express.Router();
router.use(requireAuth);

const TYPES = ['Gate Pass', 'ML (Medical Leave)', 'DL (Duty Leave)'];

// Each leave type routes to a different first-line approver (plus the admin audit store).
const APPROVER = {
  'Gate Pass': 'Hostel Warden',
  'ML (Medical Leave)': 'Class Teacher',
  'DL (Duty Leave)': 'Club Coordinator',
};

// Shape a leave document for the client: expose the approver label and the full
// append-only audit trail.
function serialize(leave) {
  const l = leave.toObject ? leave.toObject() : leave;
  return {
    id: String(l._id),
    studentId: String(l.studentId),
    type: l.type,
    fromDate: l.fromDate,
    toDate: l.toDate,
    reason: l.reason,
    details: l.details,
    status: l.status,
    createdAt: l.createdAt,
    approver: APPROVER[l.type] || 'Admin',
    audit: (l.audit || []).map((a) => ({ status: a.status, note: a.note, at: a.at })),
  };
}

// GET /api/leaves — all of the current student's leave requests, newest first.
router.get('/leaves', async (req, res, next) => {
  try {
    const rows = await Leave.find({ studentId: req.user._id }).sort({ _id: -1 });
    res.json({ leaves: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

// GET /api/leaves/:id — a single request with its audit trail.
router.get('/leaves/:id', async (req, res, next) => {
  try {
    const leave = await Leave.findOne({ _id: req.params.id, studentId: req.user._id });
    if (!leave) return res.status(404).json({ error: 'Leave request not found.' });
    res.json({ leave: serialize(leave) });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Leave request not found.' });
    next(err);
  }
});

// POST /api/leaves — file a new leave request.
router.post('/leaves', async (req, res, next) => {
  try {
    const b = req.body || {};
    const type = String(b.type || '').trim();
    const fromDate = String(b.fromDate || '').trim();
    const toDate = String(b.toDate || '').trim();
    const reason = String(b.reason || '').trim();
    const details = String(b.details || '').trim();

    if (!TYPES.includes(type)) return res.status(400).json({ error: 'Please choose a valid leave type.' });
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(fromDate) || !dateRe.test(toDate)) {
      return res.status(400).json({ error: 'Please pick valid start and end dates.' });
    }
    if (toDate < fromDate) return res.status(400).json({ error: 'The end date cannot be before the start date.' });
    if (!reason) return res.status(400).json({ error: 'Please provide a reason for your leave.' });

    const now = new Date().toISOString();
    const leave = await Leave.create({
      studentId: req.user._id, type, fromDate, toDate, reason, details,
      status: 'Pending', createdAt: now,
      audit: [{ status: 'Pending', note: `Submitted to ${APPROVER[type]} and the central admin audit store.`, at: now }],
    });
    res.status(201).json({ leave: serialize(leave) });
  } catch (err) {
    next(err);
  }
});

// POST /api/leaves/:id/cancel — withdraw a request that hasn't been decided yet.
router.post('/leaves/:id/cancel', async (req, res, next) => {
  try {
    const leave = await Leave.findOne({ _id: req.params.id, studentId: req.user._id });
    if (!leave) return res.status(404).json({ error: 'Leave request not found.' });
    if (!['Pending', 'Under Review'].includes(leave.status)) {
      return res.status(409).json({ error: 'Only pending requests can be withdrawn.' });
    }
    const now = new Date().toISOString();
    leave.status = 'Withdrawn';
    leave.audit.push({ status: 'Withdrawn', note: 'Request withdrawn by the student.', at: now });
    await leave.save();
    res.json({ leave: serialize(leave) });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Leave request not found.' });
    next(err);
  }
});

module.exports = router;
