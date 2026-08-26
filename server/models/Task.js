const mongoose = require('mongoose');

const STATUSES = ['todo', 'inprogress', 'hold', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const NoteSchema = new mongoose.Schema(
  { text: { type: String, required: true, trim: true } },
  { timestamps: true }
);

const StatusHistorySchema = new mongoose.Schema(
  { from: String, to: { type: String, enum: STATUSES }, at: { type: Date, default: Date.now } },
  { _id: false }
);

const TaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: STATUSES, default: 'todo', index: true },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true }, // optional
    tags: [{ type: String, trim: true }],
    dueDate: { type: Date },
    completedAt: { type: Date },
    notes: [NoteSchema],
    statusHistory: [StatusHistorySchema],
    dueReminderSentOn: { type: String }, // YYYY-MM-DD of last due reminder
    order: { type: Number, default: 0 },
    // Azure DevOps link (Task work item)
    azdo: {
      id: Number,
      url: String,
      apiUrl: String,
      parentId: Number, // PBI id it is currently parented under
      state: String,
      iterationPath: String,
      pendingSync: Boolean, // set when the task changed locally; cleared after a successful push
      syncedAt: Date,
      error: String,
      erroredAt: Date,
    },
  },
  { timestamps: true }
);

TaskSchema.index({ title: 'text', description: 'text', 'notes.text': 'text' });

TaskSchema.statics.STATUSES = STATUSES;
TaskSchema.statics.PRIORITIES = PRIORITIES;

module.exports = mongoose.model('Task', TaskSchema);
