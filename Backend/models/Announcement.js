// Announcement collection (was the SQLite `announcements` table). Scoped by
// program + semester (a null semester means "all semesters of that program").
const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  type: { type: String, default: 'general' },
  program: { type: String, required: true, index: true },
  semester: { type: Number, default: null }, // null = all semesters
  createdAt: { type: String, required: true },
});

module.exports = mongoose.model('Announcement', announcementSchema);
