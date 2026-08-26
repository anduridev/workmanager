const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['target', 'task', 'reminder', 'todo', 'system', 'expense'], default: 'system' },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    refType: { type: String }, // Target | Task | Reminder | DailyTodo
    refId: { type: mongoose.Schema.Types.ObjectId },
    link: { type: String }, // client route to open
    read: { type: Boolean, default: false, index: true },
    delivered: { type: Boolean, default: false }, // pushed to browser
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', NotificationSchema);
