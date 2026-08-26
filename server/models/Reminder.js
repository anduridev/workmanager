const mongoose = require('mongoose');

const ReminderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, default: '' },
    remindAt: { type: Date, required: true, index: true }, // next occurrence (carries time of day / weekday / month day)
    repeat: { type: String, enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly'], default: 'none' },
    repeatDay: { type: Number }, // monthly: day of month (1-31) so short months don't drift the schedule
    until: { type: Date }, // optional end of a repeating schedule
    snoozedUntil: { type: Date }, // one-off snooze; does not shift the schedule
    done: { type: Boolean, default: false },
    lastFiredAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Reminder', ReminderSchema);
