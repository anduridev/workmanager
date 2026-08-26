const mongoose = require('mongoose');

// Small key/value store for server-generated settings (VAPID keys, digest bookkeeping, sync cursors)
const SettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

SettingSchema.statics.get = async function (key, fallback = null) {
  const doc = await this.findOne({ key }).lean();
  return doc ? doc.value : fallback;
};
SettingSchema.statics.set = function (key, value) {
  return this.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
};

module.exports = mongoose.model('Setting', SettingSchema);
