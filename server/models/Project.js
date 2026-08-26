const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    // Azure DevOps link (Product Backlog Item)
    azdo: {
      id: Number,
      url: String,
      apiUrl: String,
      iterationPath: String,
      state: String,
      assignedTo: String,
      rev: Number,
      pulledAt: Date,
      pendingSync: Boolean, // set when the project changed locally; cleared after a successful push
      syncedAt: Date,
      error: String,
      erroredAt: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', ProjectSchema);
