const router = require('express').Router();
const Notification = require('../models/Notification');
const wrap = require('../middleware/asyncHandler');

// GET /api/notifications?unread=true  (latest 50)
router.get(
  '/',
  wrap(async (req, res) => {
    const filter = req.query.unread === 'true' ? { read: false } : {};
    const items = await Notification.find(filter).sort({ createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({ read: false });
    // Undelivered = not yet pushed to the browser; mark them delivered on fetch
    const undelivered = items.filter((n) => !n.delivered).map((n) => n._id);
    if (undelivered.length) await Notification.updateMany({ _id: { $in: undelivered } }, { delivered: true });
    res.json({ items, unreadCount, fresh: undelivered.map(String) });
  })
);

// Preview / send the morning digest now
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
    await Notification.updateMany({ read: false }, { read: true });
    res.json({ ok: true });
  })
);

router.patch(
  '/:id/read',
  wrap(async (req, res) => {
    const n = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
    res.json(n);
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

router.delete(
  '/',
  wrap(async (req, res) => {
    await Notification.deleteMany({ read: true });
    res.json({ ok: true });
  })
);

module.exports = router;
