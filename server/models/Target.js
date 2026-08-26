const mongoose = require('mongoose');

const STATUSES = ['pending', 'inprogress', 'hold', 'achieved', 'missed'];

const FollowUpSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    outcome: { type: String, enum: ['ontrack', 'atrisk', 'blocked', 'info'], default: 'info' },
  },
  { timestamps: true }
);

const TargetSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Member' }],
    status: { type: String, enum: STATUSES, default: 'pending', index: true },
    targetDate: { type: Date },
    // Follow-up reminder schedule. followUpAt = next occurrence (carries the time of day / weekday).
    followUpAt: { type: Date, index: true },
    followUpRepeat: { type: String, enum: ['none', 'daily', 'weekly'], default: 'none' },
    followUpUntil: { type: Date }, // optional end of a repeating schedule
    snoozedUntil: { type: Date }, // one-off snooze; does not shift the schedule
    reminderSent: { type: Boolean, default: false }, // for 'none' only
    followUps: [FollowUpSchema],
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  },
  { timestamps: true }
);

TargetSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('Target', TargetSchema);
