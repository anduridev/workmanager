/**
 * Create the app user (or reset their password).
 *   node server/scripts/createUser.js <username> <password> [display name]
 *   npm run create-user -- <username> <password>
 *   Optional: --role=zendesk  (account that can only use the Zendesk screen)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

(async () => {
  const role = (process.argv.find((a) => a.startsWith('--role=')) || '').split('=')[1] || '';
  const [username, password, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!username || !password) {
    console.error('Usage: node server/scripts/createUser.js <username> <password> [display name]');
    process.exit(1);
  }
  await connectDB();
  let user = await User.findOne({ username: username.toLowerCase() });
  const created = !user;
  if (!user) user = new User({ username: username.toLowerCase() });
  if (rest.length) user.displayName = rest.join(' ');
  if (role) user.role = role;
  await user.setPassword(password);
  await user.save();
  console.log(`${created ? 'Created' : 'Updated password for'} user "${user.username}"${user.role && user.role !== 'admin' ? ` (role: ${user.role})` : ''}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
