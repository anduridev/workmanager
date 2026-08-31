const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, default: '' },
    role: { type: String, enum: ['admin', 'zendesk'], default: 'admin' }, // 'zendesk' = may only use the Zendesk screen
    email: { type: String, default: '', trim: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

UserSchema.methods.setPassword = async function (password) {
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');
  this.passwordHash = await bcrypt.hash(password, 10);
};

UserSchema.methods.verifyPassword = function (password) {
  return bcrypt.compare(password || '', this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);
