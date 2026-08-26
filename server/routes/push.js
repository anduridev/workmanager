const router = require('express').Router();
const push = require('../services/push');
const wrap = require('../middleware/asyncHandler');

router.get(
  '/vapid-public-key',
  wrap(async (req, res) => {
    res.json({ key: await push.publicKey(), subscriptions: await push.count() });
  })
);

router.post(
  '/subscribe',
  wrap(async (req, res) => {
    const { subscription, label } = req.body || {};
    const doc = await push.subscribe(subscription, { userAgent: req.headers['user-agent'] || '', label });
    res.status(201).json({ ok: true, id: doc._id, subscriptions: await push.count() });
  })
);

router.post(
  '/unsubscribe',
  wrap(async (req, res) => {
    if (req.body?.endpoint) await push.unsubscribe(req.body.endpoint);
    res.json({ ok: true, subscriptions: await push.count() });
  })
);

// Send a test push to every device (handy right after enabling on a phone)
router.post(
  '/test',
  wrap(async (req, res) => {
    const { notify } = require('../services/notify');
    await notify({ kind: 'system', title: 'WorkPA push is working 🎉', body: 'You will get reminders here even when the app is closed.', link: '/' });
    res.json({ ok: true });
  })
);

module.exports = router;
