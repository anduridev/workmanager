const router = require('express').Router();
const User = require('../models/User');
const { signToken, requireAuth } = require('../middleware/auth');
const wrap = require('../middleware/asyncHandler');

// Tells the client whether a user exists yet (so it can show a helpful hint on first run)
router.get(
  '/status',
  wrap(async (req, res) => {
    const hasUser = (await User.countDocuments()) > 0;
    res.json({ authRequired: true, hasUser });
  })
);

router.post(
  '/login',
  wrap(async (req, res) => {
    const { username, password } = req.body || {};
    const user = await User.findOne({ username: String(username || '').trim().toLowerCase() });
    if (!user || !(await user.verifyPassword(password))) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: signToken(user), username: user.username, displayName: user.displayName, role: user.role || 'admin' });
  })
);

router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const user = await User.findById(req.user.sub).select('username displayName role lastLoginAt');
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    res.json(user);
  })
);

router.post(
  '/change-password',
  requireAuth,
  wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const user = await User.findById(req.user.sub);
    if (!user || !(await user.verifyPassword(currentPassword))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    try {
      await user.setPassword(newPassword);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    await user.save();
    res.json({ ok: true });
  })
);

module.exports = router;
