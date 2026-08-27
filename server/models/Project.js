const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    // Board columns: priority P1/P2/P3 (null = unprioritised); status done = finished lane
    priority: { type: String, enum: ['p1', 'p2', 'p3', null], default: null, index: true },
    status: { type: String, enum: ['active', 'done'], default: 'active', index: true },
    doneAt: { type: Date },
    order: { type: Number, default: 0 },
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
      deferred: Boolean, // "create the PBI later": no work item yet, and no sync until the user asks
      closedAt: Date, // when WorkPA moved this PBI to Done (sprint ended)
      closedReason: String,
    },
    // Earlier PBIs of this project (one per sprint): closed at sprint end, replaced by a new one in the current sprint
    azdoHistory: [
      new mongoose.Schema({ id: Number, url: String, apiUrl: String, iterationPath: String, state: String, createdAt: Date, closedAt: Date }, { _id: false }),
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', ProjectSchema);
