const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    done: { type: Boolean, default: false },
    doneAt: { type: Date },
    scheduledAt: { type: Date }, // optional date+time the item is planned for
    remindBefore: { type: Number, default: 30 }, // minutes before scheduledAt to notify (0 = at time, null = no reminder)
    reminderSentAt: { type: Date },
    carriedFrom: { type: String }, // date it was originally created on, if carried over
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const DailyTodoSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD
    items: [ItemSchema],
    focus: { type: String, default: '' }, // "main thing for today"
  },
  { timestamps: true }
);

DailyTodoSchema.index({ 'items.scheduledAt': 1 });

module.exports = mongoose.model('DailyTodo', DailyTodoSchema);
