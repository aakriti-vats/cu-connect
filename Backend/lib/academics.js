// Computation helpers for attendance, the bunk calculator, and SGPA/CGPA.
// Query helpers are async (Mongoose); the pure math helpers stay synchronous.
const { mongoose } = require('../db/database');
const { Attendance, Grade } = require('../models');
const { MIN_ATTENDANCE } = require('../config');

const oid = (id) => new mongoose.Types.ObjectId(String(id));

function round(n, d = 0) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// How many more classes can be missed while staying at/above the policy.
function safeBunks(attended, held, policy = MIN_ATTENDANCE) {
  const p = policy / 100;
  const bunks = Math.floor(attended / p) - held;
  return Math.max(0, bunks);
}

// If below policy, how many consecutive classes must be attended to recover.
function classesToRecover(attended, held, policy = MIN_ATTENDANCE) {
  const need = Math.ceil((policy * held - 100 * attended) / (100 - policy));
  return Math.max(0, need);
}

// Grade point on a 10-point scale from marks (demo mapping — kept in sync with
// the seed so teacher-published marks convert exactly like the seeded ones).
function gpFromMarks(marks) {
  if (marks >= 90) return 10;
  if (marks >= 80) return 9;
  if (marks >= 70) return 8;
  if (marks >= 60) return 7;
  if (marks >= 50) return 6;
  if (marks >= 40) return 5;
  return 0;
}

function bandFor(gpa) {
  if (gpa >= 9.0) return 'Excellent';
  if (gpa >= 7.5) return 'Good';
  if (gpa >= 6.0) return 'Average';
  return 'Needs Improvement';
}

// Semesters (with attendance data) for a student, ascending.
async function getAttendanceSemesters(studentId) {
  const rows = await Attendance.aggregate([
    { $match: { studentId: oid(studentId) } },
    { $lookup: { from: 'subjects', localField: 'subjectId', foreignField: '_id', as: 'subject' } },
    { $unwind: '$subject' },
    { $group: { _id: '$subject.semester' } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => r._id);
}

// Per-subject + overall attendance for a student, with bunk-calculator output.
// Pass a semester to scope the view to a single semester; omit for all-up totals.
async function getAttendance(studentId, policy = MIN_ATTENDANCE, semester = null) {
  const subjectMatch = semester != null ? { 'subject.semester': semester } : {};
  const rows = await Attendance.aggregate([
    { $match: { studentId: oid(studentId) } },
    { $lookup: { from: 'subjects', localField: 'subjectId', foreignField: '_id', as: 'subject' } },
    { $unwind: '$subject' },
    { $match: subjectMatch },
    {
      $group: {
        _id: '$subjectId',
        name: { $first: '$subject.name' },
        credits: { $first: '$subject.credits' },
        semester: { $first: '$subject.semester' },
        held: { $sum: 1 },
        attended: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
      },
    },
    { $sort: { name: 1 } },
  ]);

  const subjects = rows.map((r) => {
    const pct = r.held ? (r.attended / r.held) * 100 : 0;
    const below = pct < policy;
    return {
      id: String(r._id),
      name: r.name,
      credits: r.credits,
      held: r.held,
      attended: r.attended,
      percentage: round(pct, 1),
      status: pct >= 85 ? 'safe' : pct >= policy ? 'warning' : 'danger',
      safeBunks: below ? 0 : safeBunks(r.attended, r.held, policy),
      classesToRecover: below ? classesToRecover(r.attended, r.held, policy) : 0,
    };
  });

  const totalHeld = subjects.reduce((a, s) => a + s.held, 0);
  const totalAttended = subjects.reduce((a, s) => a + s.attended, 0);
  const overallPct = totalHeld ? (totalAttended / totalHeld) * 100 : 0;
  const overallBelow = overallPct < policy;

  return {
    policy,
    semester,
    semesters: await getAttendanceSemesters(studentId),
    subjects,
    overall: {
      held: totalHeld,
      attended: totalAttended,
      percentage: round(overallPct, 1),
      safeBunks: overallBelow ? 0 : safeBunks(totalAttended, totalHeld, policy),
      classesToRecover: overallBelow ? classesToRecover(totalAttended, totalHeld, policy) : 0,
      band: overallPct >= policy ? 'Good' : 'Low',
    },
  };
}

// Per-semester attendance summary (for the history pop-out).
async function getAttendanceHistory(studentId, policy = MIN_ATTENDANCE) {
  const semesters = await getAttendanceSemesters(studentId);
  const out = [];
  for (const semester of semesters) {
    const a = await getAttendance(studentId, policy, semester);
    out.push({
      semester,
      held: a.overall.held,
      attended: a.overall.attended,
      percentage: a.overall.percentage,
      band: a.overall.band,
      subjectCount: a.subjects.length,
    });
  }
  return out;
}

// SGPA per semester + cumulative CGPA for a student.
async function getResults(studentId) {
  const rows = await Grade.find({ studentId: oid(studentId) })
    .sort({ semester: 1, subjectName: 1 })
    .lean();

  const bySem = new Map();
  for (const r of rows) {
    if (!bySem.has(r.semester)) bySem.set(r.semester, []);
    bySem.get(r.semester).push(r);
  }

  const semesters = [];
  let cumPoints = 0;
  let cumCredits = 0;
  for (const [semester, subs] of [...bySem.entries()].sort((a, b) => a[0] - b[0])) {
    const credits = subs.reduce((a, s) => a + s.credits, 0);
    const points = subs.reduce((a, s) => a + s.gradePoint * s.credits, 0);
    const sgpa = credits ? points / credits : 0;
    cumPoints += points;
    cumCredits += credits;
    semesters.push({
      semester,
      totalCredits: credits,
      sgpa: round(sgpa, 2),
      band: bandFor(sgpa),
      subjects: subs.map((s) => ({
        name: s.subjectName, credits: s.credits, marks: s.marks, gradePoint: s.gradePoint,
      })),
    });
  }

  const cgpa = cumCredits ? cumPoints / cumCredits : 0;
  return {
    semesters,
    cgpa: round(cgpa, 2),
    totalCredits: cumCredits,
    performanceBand: bandFor(cgpa),
    isExcellent: cgpa >= 9.0,
  };
}

module.exports = { getAttendance, getAttendanceHistory, getAttendanceSemesters, getResults, safeBunks, classesToRecover, bandFor, gpFromMarks };
