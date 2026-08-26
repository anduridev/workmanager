const mongoose = require('mongoose');

const NoteSchema = new mongoose.Schema(
  {
    title: { type: String, default: '', trim: true },
    content: { type: String, required: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD the note belongs to
    tags: [{ type: String, trim: true }],
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true }
);

NoteSchema.index({ title: 'text', content: 'text' });

module.exports = mongoose.model('Note', NoteSchema);
