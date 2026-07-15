// User collection (was the SQLite `users` table).
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, default: '', trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    rollNumber: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, default: 'Student', enum: ['Student', 'Teacher', 'Club Member', 'Admin'] },
    program: { type: String, default: 'B.Tech CSE (AIML)' },
    year: { type: String, default: '1st Year' },
    semester: { type: Number, default: 1 },
    phone: { type: String, default: '' },
    // Teacher/Admin accounts require an approval gate; Students are auto-approved.
    approved: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
