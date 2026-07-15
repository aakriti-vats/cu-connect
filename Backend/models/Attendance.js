// Attendance collection — one document per lecture, per student. Percentages
// are computed from these documents so the numbers stay "live".
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  status: { type: String, required: true, enum: ['present', 'absent'] },
});

// One mark per student+subject+date (upserts key off this).
attendanceSchema.index({ studentId: 1, subjectId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
