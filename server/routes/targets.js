const router = require('express').Router();
const dayjs = require('dayjs');
const Target = require('../models/Target');
const wrap = require('../middleware/asyncHandler');

const OPEN = ['pending', 'inprogress', 'hold'];
const POP = { path: 'members', select: 'name role' };

router.get(
  '/',
  wrap(async (req, res) => {
    const { status, member, includeClosed, q } = req.query;
    const filter = {};
    if (status) filter.status = { $in: status.split(',') };
    else if (includeClosed !== 'true') filter.status = { $in: OPEN };
    if (member) filter.members = member;
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { description: rx }, { 'followUps.text': rx }];
    }
    const targets = await Target.find(filter).populate(POP).sort({ followUpAt: 1, targetDate: 1 });
    res.json(targets);
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const target = await Target.create(pick(req.body));
    await target.populate(POP);
    res.status(201).json(target);
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const target = await Target.findById(req.params.id).populate(POP);
    if (!target) return res.status(404).json({ error: 'Target not found' });
    res.json(target);
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    const target = await Target.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Target not found' });
    const body = pick(req.body);
    // If the schedule changed, re-arm the reminder and drop any snooze
    const scheduleChanged =
      (body.followUpAt !== undefined && String(body.followUpAt) !== String(target.followUpAt)) ||
      (body.followUpRepeat !== undefined && body.followUpRepeat !== target.followUpRepeat);
    if (scheduleChanged) {
      body.reminderSent = false;
      body.snoozedUntil = null;
    }
    Object.assign(target, body);
    await target.save();
    await target.populate(POP);
    res.json(target);
  })
);

router.patch(
  '/:id/status',
  wrap(async (req, res) => {
    const target = await Target.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Target not found' });
    if (!Target.STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
    target.status = req.body.status;
    await target.save();
    await target.populate(POP);
    res.json(target);
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await Target.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

// Log a follow-up; optionally schedule the next one (one-off targets only — repeating ones advance automatically)
router.post(
  '/:id/followups',
  wrap(async (req, res) => {
    const target = await Target.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Target not found' });
    target.followUps.push({ text: req.body.text, outcome: req.body.outcome || 'info' });
    if (target.followUpRepeat === 'none') {
      if (req.body.nextFollowUpAt) {
        target.followUpAt = new Date(req.body.nextFollowUpAt);
        target.reminderSent = false;
        target.snoozedUntil = undefined;
      } else if (req.body.clearFollowUp) {
        target.followUpAt = undefined;
        target.reminderSent = false;
        target.snoozedUntil = undefined;
      }
    } else if (req.body.stopRepeating) {
      target.followUpAt = undefined;
      target.followUpRepeat = 'none';
      target.snoozedUntil = undefined;
    }
    if (req.body.status && Target.STATUSES.includes(req.body.status)) target.status = req.body.status;
    await target.save();
    await target.populate(POP);
    res.status(201).json(target);
  })
);

router.delete(
  '/:id/followups/:fid',
  wrap(async (req, res) => {
    const target = await Target.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Target not found' });
    target.followUps.pull(req.params.fid);
    await target.save();
    await target.populate(POP);
    res.json(target);
  })
);

// Snooze the follow-up reminder by N minutes (does not shift a repeating schedule)
router.post(
  '/:id/snooze',
  wrap(async (req, res) => {
    const target = await Target.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Target not found' });
    const minutes = Number(req.body.minutes) || 60;
    target.snoozedUntil = dayjs().add(minutes, 'minute').toDate();
    target.reminderSent = false;
    await target.save();
    await target.populate(POP);
    res.json(target);
  })
);

function pick(body) {
  const out = {};
  ['title', 'description', 'members', 'status', 'targetDate', 'followUpAt', 'followUpRepeat', 'followUpUntil', 'priority'].forEach((k) => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  ['targetDate', 'followUpAt', 'followUpUntil'].forEach((k) => {
    if (out[k] === '') out[k] = null;
  });
  if (out.followUpRepeat === 'none') out.followUpUntil = null;
  return out;
}

module.exports = router;
