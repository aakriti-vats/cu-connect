// Grade collection (was the SQLite `grades` table) — drives SGPA/CGPA.
const mongoose = require('mongoose');

const gradeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  semester: { type: Number, required: true },
  subjectName: { type: String, required: true },
  credits: { type: Number, required: true },
  marks: { type: Number, required: true },
  gradePoint: { type: Number, required: true },
});

gradeSchema.index({ studentId: 1, semester: 1, subjectName: 1 }, { unique: true });

module.exports = mongoose.model('Grade', gradeSchema);
