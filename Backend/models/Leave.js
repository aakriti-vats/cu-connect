// Leave collection (was SQLite `leaves` + `leave_audit`). The audit trail is an
// embedded append-only array — never mutate or remove past entries, only push
// new ones, so the approval history can never be silently overwritten.
const mongoose = require('mongoose');

const auditEntrySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: '' },
    at: { type: String, required: true }, // ISO timestamp
  },
  { _id: false }
);

const leaveSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true },
  fromDate: { type: String, required: true },
  toDate: { type: String, required: true },
  reason: { type: String, required: true },
  details: { type: String, default: '' },
  // Convenience mirror of the latest state; `audit` below is the source of truth.
  status: { type: String, default: 'Pending' },
  createdAt: { type: String, required: true },
  audit: { type: [auditEntrySchema], default: [] },
});

module.exports = mongoose.model('Leave', leaveSchema);
