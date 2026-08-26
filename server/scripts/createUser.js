/**
 * Create the app user (or reset their password).
 *   node server/scripts/createUser.js <username> <password> [display name]
 *   npm run create-user -- <username> <password>
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

(async () => {
  const [username, password, ...rest] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: node server/scripts/createUser.js <username> <password> [display name]');
    process.exit(1);
  }
  await connectDB();
  let user = await User.findOne({ username: username.toLowerCase() });
  const created = !user;
  if (!user) user = new User({ username: username.toLowerCase() });
  if (rest.length) user.displayName = rest.join(' ');
  await user.setPassword(password);
  await user.save();
  console.log(`${created ? 'Created' : 'Updated password for'} user "${user.username}"`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
