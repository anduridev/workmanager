const router = require('express').Router();
const Member = require('../models/Member');
const Target = require('../models/Target');
const wrap = require('../middleware/asyncHandler');

router.get(
  '/',
  wrap(async (req, res) => {
    const filter = req.query.all === 'true' ? {} : { active: true };
    const members = await Member.find(filter).sort({ name: 1 });
    res.json(members);
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const member = await Member.create(pick(req.body));
    res.status(201).json(member);
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    const member = await Member.findByIdAndUpdate(req.params.id, pick(req.body), { new: true, runValidators: true });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json(member);
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await Member.findByIdAndDelete(req.params.id);
    await Target.updateMany({ members: req.params.id }, { $pull: { members: req.params.id } });
    res.json({ ok: true });
  })
);

function pick(body) {
  const out = {};
  ['name', 'role', 'email', 'active', 'notes'].forEach((k) => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  return out;
}

module.exports = router;
