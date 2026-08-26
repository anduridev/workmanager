const router = require('express').Router();
const Note = require('../models/Note');
const wrap = require('../middleware/asyncHandler');
const dayjs = require('dayjs');

router.get(
  '/',
  wrap(async (req, res) => {
    const { q, date, from, to, tag, limit } = req.query;
    const filter = {};
    if (date) filter.date = date;
    if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    if (tag) filter.tags = tag;
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { content: rx }, { tags: rx }];
    }
    const notes = await Note.find(filter)
      .sort({ pinned: -1, date: -1, createdAt: -1 })
      .limit(Number(limit) || 200);
    res.json(notes);
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const body = pick(req.body);
    if (!body.date) body.date = dayjs().format('YYYY-MM-DD');
    const note = await Note.create(body);
    res.status(201).json(note);
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    const note = await Note.findByIdAndUpdate(req.params.id, pick(req.body), { new: true, runValidators: true });
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json(note);
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await Note.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

function pick(body) {
  const out = {};
  ['title', 'content', 'date', 'tags', 'pinned'].forEach((k) => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  if (typeof out.tags === 'string') out.tags = out.tags.split(',').map((t) => t.trim()).filter(Boolean);
  return out;
}

module.exports = router;
