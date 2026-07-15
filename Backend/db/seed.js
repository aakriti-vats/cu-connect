// Seeds the database. Safe to call on every boot — it only writes when the
// users collection is empty. Run standalone with `npm run seed`.
const bcrypt = require('bcryptjs');
const { connect, disconnect } = require('./database');
const { User, Subject, Attendance, Grade, Leave, Announcement } = require('../models');

// Grade point on a 10-point scale from marks (demo mapping).
function gpFromMarks(marks) {
  if (marks >= 90) return 10;
  if (marks >= 80) return 9;
  if (marks >= 70) return 8;
  if (marks >= 60) return 7;
  if (marks >= 50) return 6;
  if (marks >= 40) return 5;
  return 0;
}

// Build `held` attendance rows for one student+subject, `attended` of them present.
function attendanceRows(studentId, subjectId, held, attended) {
  const rows = [];
  const base = new Date('2025-01-06'); // a Monday
  for (let i = 0; i < held; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i * 2); // roughly every other day
    rows.push({
      studentId,
      subjectId,
      date: d.toISOString().slice(0, 10),
      status: i < attended ? 'present' : 'absent',
    });
  }
  return rows;
}

const LEAVE_APPROVER = {
  'Gate Pass': 'Hostel Warden',
  'ML (Medical Leave)': 'Class Teacher',
  'DL (Duty Leave)': 'Club Coordinator',
};

// Build a leave document (with its embedded audit trail) consistent with its final status.
function buildLeave(studentId, l) {
  const createdAt = l.fromDate + 'T09:00:00.000Z';
  const approver = LEAVE_APPROVER[l.type];
  const at = (hours) => new Date(new Date(createdAt).getTime() + hours * 3600 * 1000).toISOString();
  const audit = [{ status: 'Pending', note: `Submitted to ${approver} and the central admin audit store.`, at: at(0) }];
  if (l.status === 'Approved') {
    audit.push({ status: 'Under Review', note: `Picked up for review by ${approver}.`, at: at(2) });
    audit.push({ status: 'Approved', note: `Approved by ${approver}.`, at: at(6) });
  } else if (l.status === 'Rejected') {
    audit.push({ status: 'Under Review', note: `Picked up for review by ${approver}.`, at: at(2) });
    audit.push({ status: 'Rejected', note: 'Rejected — no supporting document attached.', at: at(5) });
  }
  return {
    studentId, type: l.type, fromDate: l.fromDate, toDate: l.toDate,
    reason: l.reason, details: l.details, status: l.status, createdAt, audit,
  };
}

async function seed() {
  const already = await User.countDocuments();
  if (already > 0) return { seeded: false };

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  // ---- Users (password for every demo account is "password123") ----
  const [pallakshi, aarav, isha, teacher] = await User.create([
    {
      firstName: 'Pallakshi', lastName: 'Aggarwal',
      email: 'pallakshi@chitkara.edu.in', rollNumber: '2210991045',
      passwordHash: hash('password123'), role: 'Student',
      program: 'B.Tech CSE (AIML)', year: '2nd Year', semester: 4,
      phone: '+91 98765 43210',
    },
    {
      firstName: 'Aarav', lastName: 'Sharma',
      email: 'aarav@chitkara.edu.in', rollNumber: '2210990001',
      passwordHash: hash('password123'), role: 'Student',
      program: 'B.Tech CSE (AIML)', year: '2nd Year', semester: 4,
      phone: '+91 91234 56780',
    },
    {
      firstName: 'Isha', lastName: 'Verma',
      email: 'isha@chitkara.edu.in', rollNumber: '2210990002',
      passwordHash: hash('password123'), role: 'Student',
      program: 'B.Tech CSE (AIML)', year: '2nd Year', semester: 4,
      phone: '+91 99887 76650',
    },
    {
      firstName: 'Rajesh', lastName: 'Khanna',
      email: 'rajesh@chitkara.edu.in', rollNumber: 'FAC-CSE-014',
      passwordHash: hash('password123'), role: 'Teacher',
      program: 'B.Tech CSE (AIML)', year: 'Faculty', semester: 4,
      phone: '+91 98111 22334', approved: true,
    },
  ]);

  // ---- Subjects for semesters 1–4 (AIML). Each: [name, credits] ----
  const subjectsBySem = {
    1: [['Mathematics I', 4], ['Chemistry', 4], ['Basic Electrical', 3], ['Workshop', 2], ['Communication Skills', 3]],
    2: [['Mathematics II', 4], ['Physics', 4], ['Programming in C', 4], ['English', 3], ['Environmental Studies', 2]],
    3: [['Mathematics III', 4], ['Data Structures', 4], ['Digital Electronics', 3], ['Java Programming', 4], ['Economics', 3]],
    4: [['Operating Systems', 4], ['DBMS', 4], ['Computer Networks', 4], ['OOPs', 4], ['Software Engineering', 3]],
  };
  const subjectDocs = [];
  for (const [sem, list] of Object.entries(subjectsBySem)) {
    for (const [name, credits] of list) {
      subjectDocs.push({ name, credits, semester: Number(sem), program: 'B.Tech CSE (AIML)' });
    }
  }
  const subjects = await Subject.create(subjectDocs);
  // subjectId keyed by "sem::name" so same-named subjects in different sems stay distinct.
  const subjectIds = {};
  for (const s of subjects) subjectIds[s.semester + '::' + s.name] = s._id;

  // ---- Attendance per semester [held, attended] ----
  // Pallakshi: strong in past semesters, borderline (~76%) in the current one.
  const attPallakshi = {
    1: { 'Mathematics I': [46, 44], 'Chemistry': [44, 41], 'Basic Electrical': [42, 40], 'Workshop': [30, 29], 'Communication Skills': [40, 38] },
    2: { 'Mathematics II': [48, 45], 'Physics': [46, 42], 'Programming in C': [50, 48], 'English': [40, 37], 'Environmental Studies': [28, 26] },
    3: { 'Mathematics III': [48, 43], 'Data Structures': [50, 46], 'Digital Electronics': [42, 38], 'Java Programming': [50, 47], 'Economics': [38, 33] },
    4: { 'Operating Systems': [50, 37], 'DBMS': [50, 38], 'Computer Networks': [48, 34], 'OOPs': [47, 40], 'Software Engineering': [40, 31] },
  };
  // Aarav: topper — consistently high attendance every semester.
  const attAarav = {
    1: { 'Mathematics I': [46, 45], 'Chemistry': [44, 43], 'Basic Electrical': [42, 41], 'Workshop': [30, 30], 'Communication Skills': [40, 39] },
    2: { 'Mathematics II': [48, 47], 'Physics': [46, 45], 'Programming in C': [50, 50], 'English': [40, 39], 'Environmental Studies': [28, 28] },
    3: { 'Mathematics III': [48, 47], 'Data Structures': [50, 49], 'Digital Electronics': [42, 41], 'Java Programming': [50, 49], 'Economics': [38, 37] },
    4: { 'Operating Systems': [50, 47], 'DBMS': [50, 49], 'Computer Networks': [48, 45], 'OOPs': [47, 46], 'Software Engineering': [40, 39] },
  };
  // Isha: solid mid-table student, comfortably above the attendance policy.
  const attIsha = {
    1: { 'Mathematics I': [46, 42], 'Chemistry': [44, 40], 'Basic Electrical': [42, 39], 'Workshop': [30, 28], 'Communication Skills': [40, 36] },
    2: { 'Mathematics II': [48, 44], 'Physics': [46, 43], 'Programming in C': [50, 47], 'English': [40, 36], 'Environmental Studies': [28, 25] },
    3: { 'Mathematics III': [48, 44], 'Data Structures': [50, 45], 'Digital Electronics': [42, 39], 'Java Programming': [50, 46], 'Economics': [38, 34] },
    4: { 'Operating Systems': [50, 43], 'DBMS': [50, 44], 'Computer Networks': [48, 41], 'OOPs': [47, 42], 'Software Engineering': [40, 35] },
  };
  const attendanceDocs = [];
  const collectAttendance = (studentId, bySem) => {
    for (const [sem, subs] of Object.entries(bySem)) {
      for (const [name, [held, att]] of Object.entries(subs)) {
        const sid = subjectIds[sem + '::' + name];
        attendanceDocs.push(...attendanceRows(studentId, sid, held, att));
      }
    }
  };
  collectAttendance(pallakshi._id, attPallakshi);
  collectAttendance(aarav._id, attAarav);
  collectAttendance(isha._id, attIsha);
  await Attendance.insertMany(attendanceDocs);

  // ---- Grades for completed semesters (drives SGPA/CGPA) ----
  // Pallakshi: solid "Good" performer (CGPA ~8.4).
  const pallakshiGrades = [
    [1, 'Mathematics I', 4, 75], [1, 'Chemistry', 4, 72], [1, 'Basic Electrical', 3, 78],
    [1, 'Workshop', 2, 85], [1, 'Communication Skills', 3, 74],
    [2, 'Mathematics II', 4, 76], [2, 'Physics', 4, 81], [2, 'Programming in C', 4, 88],
    [2, 'English', 3, 79], [2, 'Environmental Studies', 2, 77],
    [3, 'Mathematics III', 4, 79], [3, 'Data Structures', 4, 76], [3, 'Digital Electronics', 3, 82],
    [3, 'Java Programming', 4, 78], [3, 'Economics', 3, 85],
  ];
  // Aarav: topper — every semester clears 9.0 (Excellent band).
  const aaravGrades = [
    [1, 'Mathematics I', 4, 94], [1, 'Chemistry', 4, 85], [1, 'Basic Electrical', 3, 88],
    [1, 'Workshop', 2, 96], [1, 'Communication Skills', 3, 90],
    [2, 'Mathematics II', 4, 87], [2, 'Physics', 4, 91], [2, 'Programming in C', 4, 97],
    [2, 'English', 3, 88], [2, 'Environmental Studies', 2, 92],
    [3, 'Mathematics III', 4, 96], [3, 'Data Structures', 4, 89], [3, 'Digital Electronics', 3, 93],
    [3, 'Java Programming', 4, 88], [3, 'Economics', 3, 98],
  ];
  // Isha: consistent "Good" band, a notch below the topper.
  const ishaGrades = [
    [1, 'Mathematics I', 4, 81], [1, 'Chemistry', 4, 78], [1, 'Basic Electrical', 3, 83],
    [1, 'Workshop', 2, 88], [1, 'Communication Skills', 3, 80],
    [2, 'Mathematics II', 4, 82], [2, 'Physics', 4, 85], [2, 'Programming in C', 4, 90],
    [2, 'English', 3, 83], [2, 'Environmental Studies', 2, 84],
    [3, 'Mathematics III', 4, 84], [3, 'Data Structures', 4, 82], [3, 'Digital Electronics', 3, 86],
    [3, 'Java Programming', 4, 83], [3, 'Economics', 3, 88],
  ];
  const gradeDocs = [];
  const collectGrades = (studentId, grades) => {
    for (const [semester, subjectName, credits, marks] of grades) {
      gradeDocs.push({ studentId, semester, subjectName, credits, marks, gradePoint: gpFromMarks(marks) });
    }
  };
  collectGrades(pallakshi._id, pallakshiGrades);
  collectGrades(aarav._id, aaravGrades);
  collectGrades(isha._id, ishaGrades);
  await Grade.insertMany(gradeDocs);

  // ---- Leave requests for Pallakshi (demo) ----
  const leaves = [
    { type: 'Gate Pass', fromDate: '2025-05-12', toDate: '2025-05-12', reason: 'Family Function', details: 'Attending a family function at home; will return by evening.', status: 'Approved' },
    { type: 'ML (Medical Leave)', fromDate: '2025-05-10', toDate: '2025-05-11', reason: 'Fever & Cold', details: 'Down with viral fever, advised two days of rest by the campus doctor.', status: 'Approved' },
    { type: 'DL (Duty Leave)', fromDate: '2025-05-05', toDate: '2025-05-05', reason: 'Tech Club Event', details: 'Volunteering at the annual tech fest organised by the Tech Club.', status: 'Pending' },
    { type: 'ML (Medical Leave)', fromDate: '2025-04-28', toDate: '2025-04-28', reason: 'Not Well', details: 'Requested a day off without a medical certificate.', status: 'Rejected' },
  ];
  await Leave.create(leaves.map((l) => buildLeave(pallakshi._id, l)));

  // ---- Announcements posted by the teacher (students read these) ----
  const announcements = [
    { title: 'Operating Systems — MST-2 on 18 July', body: 'The second mid-semester test for Operating Systems is scheduled for 18 July, 10:00 AM in Block D-204. Syllabus: units 3 and 4.', type: 'exam' },
    { title: 'DBMS assignment submission extended', body: 'The DBMS normalization assignment deadline has been extended to 14 July, 11:59 PM. Submit on the portal.', type: 'assignment' },
    { title: 'Extra Computer Networks doubt class', body: 'An extra doubt-clearing session for Computer Networks will be held this Friday at 3:00 PM. Attendance is optional but recommended.', type: 'general' },
  ];
  await Announcement.create(announcements.map((a, i) => ({
    authorId: teacher._id, title: a.title, body: a.body, type: a.type,
    program: 'B.Tech CSE (AIML)', semester: 4,
    createdAt: new Date(Date.parse('2025-07-08T09:00:00.000Z') + i * 3600 * 1000).toISOString(),
  })));

  return { seeded: true };
}

module.exports = seed;

// Allow running standalone: `node db/seed.js`
if (require.main === module) {
  (async () => {
    await connect();
    const result = await seed();
    console.log(result.seeded ? 'Database seeded.' : 'Database already had data — nothing to seed.');
    await disconnect();
  })().catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
}
