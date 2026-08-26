const router = require('express').Router();
const dayjs = require('dayjs');
const Reminder = require('../models/Reminder');
const wrap = require('../middleware/asyncHandler');

router.get(
  '/',
  wrap(async (req, res) => {
    const filter = req.query.includeDone === 'true' ? {} : { done: false };
    const reminders = await Reminder.find(filter).sort({ remindAt: 1 });
    res.json(reminders);
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const reminder = await Reminder.create(pick(req.body));
    res.status(201).json(reminder);
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    const reminder = await Reminder.findById(req.params.id);
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
    const body = pick(req.body);
    const scheduleChanged =
      (body.remindAt !== undefined && String(new Date(body.remindAt)) !== String(reminder.remindAt)) ||
      (body.repeat !== undefined && body.repeat !== reminder.repeat);
    if (scheduleChanged) {
      body.snoozedUntil = null;
      if (body.done === undefined) body.done = false;
    }
    Object.assign(reminder, body);
    await reminder.save();
    res.json(reminder);
  })
);

// Snooze by N minutes (does not shift a repeating schedule)
router.post(
  '/:id/snooze',
  wrap(async (req, res) => {
    const reminder = await Reminder.findById(req.params.id);
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
    reminder.snoozedUntil = dayjs().add(Number(req.body.minutes) || 30, 'minute').toDate();
    reminder.done = false;
    await reminder.save();
    res.json(reminder);
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await Reminder.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

function pick(body) {
  const out = {};
  ['title', 'body', 'remindAt', 'repeat', 'repeatDay', 'until', 'done'].forEach((k) => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  if (out.until === '') out.until = null;
  if (out.repeat && out.repeat === 'none') {
    out.until = null;
    out.repeatDay = null;
  }
  if (out.repeat === 'monthly' && !out.repeatDay && out.remindAt) out.repeatDay = dayjs(out.remindAt).date();
  return out;
}

module.exports = router;
