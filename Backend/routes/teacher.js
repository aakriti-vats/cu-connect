// Teacher routes. A teacher can VIEW everything a student sees (attendance,
// results/GPA, leaves) for the students in their program cohort, and can
// UPLOAD/UPDATE the data that flows back to those students:
//   - mark/update attendance per lecture   -> student attendance + bunk calc
//   - publish/update marks (grade points)   -> student SGPA/CGPA
//   - decide leave requests (Under Review/Approved/Rejected, append-only audit)
//   - post announcements                     -> student notifications
// Every route re-checks the Teacher role server-side (never trust the client).
const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { User, Subject, Attendance, Grade, Leave, Announcement } = require('../models');
const { getAttendance, getResults, gpFromMarks } = require('../lib/academics');
const { notifyStudents, notifyProgram } = require('../lib/realtime');
const { MIN_ATTENDANCE } = require('../config');

const router = express.Router();
router.use(requireAuth, requireRole('Teacher', 'Admin'));

// Leave-type -> first-line approver, mirrored from routes/leave.js.
const APPROVER = {
  'Gate Pass': 'Hostel Warden',
  'ML (Medical Leave)': 'Class Teacher',
  'DL (Duty Leave)': 'Club Coordinator',
};

// The students this teacher is responsible for: same program, Student role.
function cohortStudents(teacher) {
  return User.find({ role: 'Student', program: teacher.program })
    .select('firstName lastName email rollNumber program year semester phone')
    .sort({ firstName: 1, lastName: 1 })
    .lean();
}

function studentInCohort(teacher, studentId) {
  return User.findOne({ _id: studentId, role: 'Student', program: teacher.program });
}

function fullName(u) {
  return `${u.firstName}${u.lastName ? ' ' + u.lastName : ''}`.trim();
}
function initials(u) {
  return (u.firstName[0] + (u.lastName ? u.lastName[0] : '')).toUpperCase();
}

// ---------------------------------------------------------------------------
// GET /api/teacher/overview — headline numbers for the teacher dashboard.
// ---------------------------------------------------------------------------
router.get('/overview', async (req, res, next) => {
  try {
    const students = await cohortStudents(req.user);
    let attSum = 0, attCount = 0, cgpaSum = 0, cgpaCount = 0, excellent = 0;
    for (const s of students) {
      const a = await getAttendance(s._id, MIN_ATTENDANCE, req.user.semester);
      if (a.overall.held > 0) { attSum += a.overall.percentage; attCount++; }
      const r = await getResults(s._id);
      if (r.totalCredits > 0) { cgpaSum += r.cgpa; cgpaCount++; }
      if (r.isExcellent) excellent++;
    }
    const subjectCount = await Subject.countDocuments({ program: req.user.program, semester: req.user.semester });

    // Leaves routed to this teacher's cohort that still need a decision.
    const cohortIds = students.map((s) => s._id);
    const pendingLeaves = await Leave.countDocuments({
      studentId: { $in: cohortIds },
      status: { $in: ['Pending', 'Under Review'] },
    });

    res.json({
      program: req.user.program,
      semester: req.user.semester,
      studentCount: students.length,
      subjectCount,
      pendingLeaves,
      excellentCount: excellent,
      avgAttendance: attCount ? Math.round((attSum / attCount) * 10) / 10 : 0,
      avgCgpa: cgpaCount ? Math.round((cgpaSum / cgpaCount) * 100) / 100 : 0,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/teacher/students — roster with each student's headline att% + CGPA.
// ---------------------------------------------------------------------------
router.get('/students', async (req, res, next) => {
  try {
    const roster = await cohortStudents(req.user);
    const students = [];
    for (const s of roster) {
      const a = await getAttendance(s._id, MIN_ATTENDANCE, req.user.semester);
      const r = await getResults(s._id);
      students.push({
        id: String(s._id),
        name: fullName(s),
        initials: initials(s),
        rollNumber: s.rollNumber,
        email: s.email,
        year: s.year,
        semester: s.semester,
        attendance: a.overall.percentage,
        attendanceBand: a.overall.band,
        cgpa: r.cgpa,
        performanceBand: r.performanceBand,
        isExcellent: r.isExcellent,
      });
    }
    res.json({ students });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/teacher/students/:id — full student view (same data the student sees).
// ---------------------------------------------------------------------------
router.get('/students/:id', async (req, res, next) => {
  try {
    const s = await studentInCohort(req.user, req.params.id);
    if (!s) return res.status(404).json({ error: 'Student not found in your cohort.' });
    const policy = Number(req.query.policy) || MIN_ATTENDANCE;
    const attendance = await getAttendance(s._id, policy, s.semester);
    const results = await getResults(s._id);
    const leaveRows = await Leave.find({ studentId: s._id }).sort({ _id: -1 }).lean();
    res.json({
      student: {
        id: String(s._id), name: fullName(s), initials: initials(s), rollNumber: s.rollNumber,
        email: s.email, phone: s.phone, program: s.program, year: s.year, semester: s.semester,
      },
      attendance,
      results,
      leaves: leaveRows.map((l) => ({
        id: String(l._id), type: l.type, fromDate: l.fromDate, toDate: l.toDate,
        reason: l.reason, details: l.details, status: l.status, createdAt: l.createdAt,
        approver: APPROVER[l.type] || 'Admin',
      })),
    });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Student not found in your cohort.' });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/teacher/subjects?semester=4 — subjects for the program/semester.
// ---------------------------------------------------------------------------
router.get('/subjects', async (req, res, next) => {
  try {
    const semester = req.query.semester ? Number(req.query.semester) : req.user.semester;
    const rows = await Subject.find({ program: req.user.program, semester }).sort({ name: 1 }).lean();
    const subjects = rows.map((s) => ({ id: String(s._id), name: s.name, credits: s.credits, semester: s.semester }));
    res.json({ semester, subjects });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/teacher/attendance?subjectId=&date= — roster with the mark each
// student already has for that subject on that date (for editing/prefill).
// ---------------------------------------------------------------------------
router.get('/attendance', async (req, res, next) => {
  try {
    const date = String(req.query.date || '').trim();
    const subject = await Subject.findOne({ _id: req.query.subjectId, program: req.user.program }).catch(() => null);
    if (!subject) return res.status(404).json({ error: 'Subject not found for your program.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Please provide a valid date (YYYY-MM-DD).' });
    }
    const students = (await cohortStudents(req.user)).filter((s) => s.semester === subject.semester);
    const roster = [];
    for (const s of students) {
      const row = await Attendance.findOne({ studentId: s._id, subjectId: subject._id, date }).lean();
      // Overall percentage in this subject, for context while marking.
      const agg = await Attendance.aggregate([
        { $match: { studentId: s._id, subjectId: subject._id } },
        {
          $group: {
            _id: null,
            held: { $sum: 1 },
            attended: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          },
        },
      ]);
      const held = agg.length ? agg[0].held : 0;
      const attended = agg.length ? agg[0].attended : 0;
      const pct = held ? Math.round((attended / held) * 1000) / 10 : 0;
      roster.push({
        id: String(s._id), name: fullName(s), initials: initials(s), rollNumber: s.rollNumber,
        status: row ? row.status : null, // null = not marked yet for this date
        percentage: pct, held, attended,
      });
    }
    res.json({ subject: { id: String(subject._id), name: subject.name, semester: subject.semester }, date, roster });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Subject not found for your program.' });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/teacher/attendance — mark/update attendance for a subject on a date.
// Body: { subjectId, date, marks: [{ studentId, status }] }. Upsert per student.
// ---------------------------------------------------------------------------
router.post('/attendance', async (req, res, next) => {
  try {
    const b = req.body || {};
    const date = String(b.date || '').trim();
    const marks = Array.isArray(b.marks) ? b.marks : [];

    const subject = await Subject.findOne({ _id: b.subjectId, program: req.user.program }).catch(() => null);
    if (!subject) return res.status(404).json({ error: 'Subject not found for your program.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Please provide a valid date (YYYY-MM-DD).' });
    }
    if (!marks.length) return res.status(400).json({ error: 'No attendance marks were provided.' });

    let saved = 0;
    const affected = [];
    for (const m of marks) {
      const status = m.status === 'present' ? 'present' : m.status === 'absent' ? 'absent' : null;
      if (!status) continue;
      const student = await studentInCohort(req.user, m.studentId).catch(() => null);
      if (!student || student.semester !== subject.semester) continue;
      await Attendance.findOneAndUpdate(
        { studentId: student._id, subjectId: subject._id, date },
        { $set: { status } },
        { upsert: true, new: true }
      );
      affected.push(String(student._id));
      saved++;
    }
    // Live-push so each affected student's attendance view refreshes instantly.
    notifyStudents(affected, 'attendance:updated', { subject: subject.name, date });
    res.json({ ok: true, saved, message: `Attendance saved for ${saved} student(s).` });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/teacher/grades?semester=&subject= — marks each student has for a
// given semester+subject (for prefill), plus the subject's credits.
// ---------------------------------------------------------------------------
router.get('/grades', async (req, res, next) => {
  try {
    const semester = Number(req.query.semester) || req.user.semester;
    const subjectName = String(req.query.subject || '').trim();
    if (!subjectName) return res.status(400).json({ error: 'Please choose a subject.' });
    const subject = await Subject.findOne({ program: req.user.program, semester, name: subjectName }).lean();
    const credits = subject ? subject.credits : 3;

    const students = await cohortStudents(req.user);
    const roster = [];
    for (const s of students) {
      const g = await Grade.findOne({ studentId: s._id, semester, subjectName }).lean();
      roster.push({
        id: String(s._id), name: fullName(s), initials: initials(s), rollNumber: s.rollNumber,
        marks: g ? g.marks : null, gradePoint: g ? g.gradePoint : null,
      });
    }
    res.json({ semester, subject: subjectName, credits, roster });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/teacher/grades — publish/update marks for a semester+subject.
// Body: { semester, subject, credits?, marks: [{ studentId, marks }] }.
// Grade point is derived from marks so student SGPA/CGPA stays consistent.
// ---------------------------------------------------------------------------
router.post('/grades', async (req, res, next) => {
  try {
    const b = req.body || {};
    const semester = Number(b.semester);
    const subjectName = String(b.subject || '').trim();
    const entries = Array.isArray(b.marks) ? b.marks : [];
    if (!Number.isInteger(semester) || semester < 1 || semester > 8) {
      return res.status(400).json({ error: 'Please choose a valid semester.' });
    }
    if (!subjectName) return res.status(400).json({ error: 'Please choose a subject.' });
    if (!entries.length) return res.status(400).json({ error: 'No marks were provided.' });

    const subject = await Subject.findOne({ program: req.user.program, semester, name: subjectName }).lean();
    const credits = Number(b.credits) || (subject ? subject.credits : 3);

    let saved = 0;
    const affected = [];
    for (const e of entries) {
      const marks = Number(e.marks);
      if (!Number.isFinite(marks) || marks < 0 || marks > 100) continue;
      const student = await studentInCohort(req.user, e.studentId).catch(() => null);
      if (!student) continue;
      const gp = gpFromMarks(marks);
      await Grade.findOneAndUpdate(
        { studentId: student._id, semester, subjectName },
        { $set: { credits, marks, gradePoint: gp } },
        { upsert: true, new: true }
      );
      affected.push(String(student._id));
      saved++;
    }
    // Live-push so each affected student's results/GPA view refreshes instantly.
    notifyStudents(affected, 'results:updated', { subject: subjectName, semester });
    res.json({ ok: true, saved, message: `Marks published for ${saved} student(s).` });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/teacher/leaves — all cohort leave requests with their audit trail.
// ---------------------------------------------------------------------------
router.get('/leaves', async (req, res, next) => {
  try {
    const cohort = await User.find({ role: 'Student', program: req.user.program })
      .select('firstName lastName rollNumber')
      .lean();
    const byId = new Map(cohort.map((u) => [String(u._id), u]));
    const rows = await Leave.find({ studentId: { $in: cohort.map((u) => u._id) } }).sort({ _id: -1 }).lean();
    const leaves = rows.map((l) => {
      const u = byId.get(String(l.studentId)) || {};
      return {
        id: String(l._id), studentId: String(l.studentId),
        studentName: `${u.firstName || ''}${u.lastName ? ' ' + u.lastName : ''}`.trim(),
        rollNumber: u.rollNumber, type: l.type, fromDate: l.fromDate, toDate: l.toDate,
        reason: l.reason, details: l.details, status: l.status, createdAt: l.createdAt,
        approver: APPROVER[l.type] || 'Admin',
        audit: (l.audit || []).map((a) => ({ status: a.status, note: a.note, at: a.at })),
      };
    });
    res.json({ leaves });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/teacher/leaves/:id/status — advance a leave through the pipeline.
// Body: { status: 'Under Review'|'Approved'|'Rejected', note? }. Append-only:
// the decision is pushed to the leave's audit trail and never overwrites history.
// ---------------------------------------------------------------------------
const DECISIONS = ['Under Review', 'Approved', 'Rejected'];
router.post('/leaves/:id/status', async (req, res, next) => {
  try {
    const status = String((req.body || {}).status || '').trim();
    const note = String((req.body || {}).note || '').trim();
    if (!DECISIONS.includes(status)) {
      return res.status(400).json({ error: 'Choose a valid status (Under Review, Approved or Rejected).' });
    }
    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: 'Leave request not found in your cohort.' });
    // Enforce cohort scoping: the leave must belong to a student in this program.
    const owner = await studentInCohort(req.user, leave.studentId);
    if (!owner) return res.status(404).json({ error: 'Leave request not found in your cohort.' });
    if (['Approved', 'Rejected', 'Withdrawn'].includes(leave.status)) {
      return res.status(409).json({ error: `This request is already ${leave.status.toLowerCase()} and cannot be changed.` });
    }

    const now = new Date().toISOString();
    const label = `${req.user.firstName}${req.user.lastName ? ' ' + req.user.lastName : ''}`.trim();
    const defaultNote = status === 'Under Review'
      ? `Picked up for review by ${label}.`
      : `${status} by ${label}.`;
    leave.status = status;
    leave.audit.push({ status, note: note || defaultNote, at: now });
    await leave.save();

    // Live-push so the student's leave view + dashboard update instantly.
    notifyStudents([String(leave.studentId)], 'leave:updated', { leaveId: String(leave._id), type: leave.type, status });
    res.json({
      ok: true,
      leave: {
        id: String(leave._id), studentId: String(leave.studentId), type: leave.type,
        fromDate: leave.fromDate, toDate: leave.toDate, reason: leave.reason, details: leave.details,
        status: leave.status, createdAt: leave.createdAt, approver: APPROVER[leave.type] || 'Admin',
        audit: leave.audit.map((a) => ({ status: a.status, note: a.note, at: a.at })),
      },
    });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Leave request not found in your cohort.' });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Announcements — teacher posts, students read (see routes/data.js student side).
// ---------------------------------------------------------------------------
router.get('/announcements', async (req, res, next) => {
  try {
    const rows = await Announcement.find({ authorId: req.user._id }).sort({ _id: -1 }).lean();
    const announcements = rows.map((a) => ({
      id: String(a._id), title: a.title, body: a.body, type: a.type,
      program: a.program, semester: a.semester, createdAt: a.createdAt,
    }));
    res.json({ announcements });
  } catch (err) {
    next(err);
  }
});

const ANN_TYPES = ['general', 'exam', 'assignment', 'result', 'attendance'];
router.post('/announcements', async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const body = String(b.body || '').trim();
    const type = ANN_TYPES.includes(b.type) ? b.type : 'general';
    const semester = b.semester === null || b.semester === '' || b.semester === undefined
      ? null : Number(b.semester);
    if (!title) return res.status(400).json({ error: 'Please add a title for your announcement.' });
    if (semester !== null && (!Number.isInteger(semester) || semester < 1 || semester > 8)) {
      return res.status(400).json({ error: 'Choose a valid target semester (or all).' });
    }
    const now = new Date().toISOString();
    const created = await Announcement.create({
      authorId: req.user._id, title, body, type, program: req.user.program, semester, createdAt: now,
    });
    // Live-push to the targeted cohort so it appears in their notifications feed.
    notifyProgram(req.user.program, semester, 'announcement:new', {
      id: String(created._id), title: created.title, type: created.type,
    });
    res.status(201).json({
      ok: true,
      announcement: {
        id: String(created._id), title: created.title, body: created.body, type: created.type,
        program: created.program, semester: created.semester, createdAt: created.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/announcements/:id', async (req, res, next) => {
  try {
    const result = await Announcement.deleteOne({ _id: req.params.id, authorId: req.user._id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Announcement not found.' });
    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Announcement not found.' });
    next(err);
  }
});

module.exports = router;
