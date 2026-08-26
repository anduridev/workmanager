const mongoose = require('mongoose');

// One document per browser/device that opted in to Web Push
const PushSubscriptionSchema = new mongoose.Schema(
  {
    endpoint: { type: String, required: true, unique: true },
    keys: { p256dh: String, auth: String },
    expirationTime: { type: Number },
    userAgent: { type: String, default: '' },
    label: { type: String, default: '' }, // e.g. "Chrome on Windows"
    lastUsedAt: { type: Date },
    failures: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);
