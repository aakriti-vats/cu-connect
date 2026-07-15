// Subject collection (was the SQLite `subjects` table).
const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  credits: { type: Number, default: 3 },
  semester: { type: Number, required: true },
  program: { type: String, default: 'B.Tech CSE (AIML)' },
});

module.exports = mongoose.model('Subject', subjectSchema);
