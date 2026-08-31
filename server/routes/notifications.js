const router = require('express').Router();
const Notification = require('../models/Notification');
const wrap = require('../middleware/asyncHandler');

// Restricted (zendesk-role) accounts only ever see Zendesk notifications — nothing else leaks to them
const scope = (req) => (req.user?.role === 'zendesk' ? { kind: 'zendesk' } : {});

// GET /api/notifications?unread=true  (latest 50)
router.get(
  '/',
  wrap(async (req, res) => {
    const filter = { ...scope(req), ...(req.query.unread === 'true' ? { read: false } : {}) };
    const items = await Notification.find(filter).sort({ createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({ ...scope(req), read: false });
    // Undelivered = not yet pushed to the browser; mark them delivered on fetch
    const undelivered = items.filter((n) => !n.delivered).map((n) => n._id);
    if (undelivered.length) await Notification.updateMany({ _id: { $in: undelivered } }, { delivered: true });
    res.json({ items, unreadCount, fresh: undelivered.map(String) });
  })
);

// Preview / send the morning digest now (admin only)
router.use('/digest', (req, res, next) => (req.user?.role === 'zendesk' ? res.status(403).json({ error: 'Not available for this account' }) : next()));
router.get(
  '/digest',
  wrap(async (req, res) => {
    const { buildDigest } = require('../services/digest');
    res.json(await buildDigest());
  })
);
router.post(
  '/digest',
  wrap(async (req, res) => {
    const { sendDigest } = require('../services/digest');
    res.json(await sendDigest());
  })
);

router.patch(
  '/read-all',
  wrap(async (req, res) => {
    await Notification.updateMany({ ...scope(req), read: false }, { read: true });
    res.json({ ok: true });
  })
);

router.patch(
  '/:id/read',
  wrap(async (req, res) => {
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, ...scope(req) }, { read: true }, { new: true });
    res.json(n);
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await Notification.findOneAndDelete({ _id: req.params.id, ...scope(req) });
    res.json({ ok: true });
  })
);

router.delete(
  '/',
  wrap(async (req, res) => {
    await Notification.deleteMany({ ...scope(req), read: true });
    res.json({ ok: true });
  })
);

module.exports = router;
