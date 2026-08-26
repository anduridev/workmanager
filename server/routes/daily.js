const router = require('express').Router();
const dayjs = require('dayjs');
const DailyTodo = require('../models/DailyTodo');
const wrap = require('../middleware/asyncHandler');

const today = () => dayjs().format('YYYY-MM-DD');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function getOrCreate(date) {
  if (!isDate(date)) {
    const err = new Error('Invalid date, expected YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  let doc = await DailyTodo.findOne({ date });
  if (!doc) doc = await DailyTodo.create({ date, items: [] });
  return doc;
}

function sortItems(doc) {
  doc.items.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.scheduledAt && b.scheduledAt) return a.scheduledAt - b.scheduledAt;
    if (a.scheduledAt) return -1;
    if (b.scheduledAt) return 1;
    return (a.order || 0) - (b.order || 0);
  });
  return doc;
}

/** Normalise schedule fields from the body: scheduledAt (ISO|null), remindBefore (minutes|null). */
function applySchedule(item, body, date) {
  if (body.scheduledAt !== undefined) {
    if (!body.scheduledAt) item.scheduledAt = undefined;
    else {
      const d = dayjs(body.scheduledAt);
      if (!d.isValid()) {
        const err = new Error('Invalid scheduledAt');
        err.status = 400;
        throw err;
      }
      item.scheduledAt = d.toDate();
    }
    item.reminderSentAt = undefined; // re-arm reminder whenever the time changes
  }
  if (body.remindBefore !== undefined) {
    item.remindBefore = body.remindBefore === null || body.remindBefore === '' ? null : Number(body.remindBefore);
  }
  // Scheduled time must be on the item's day; if only a time was supplied on another day, shift it
  if (item.scheduledAt && dayjs(item.scheduledAt).format('YYYY-MM-DD') !== date) {
    const t = dayjs(item.scheduledAt);
    item.scheduledAt = dayjs(date).hour(t.hour()).minute(t.minute()).second(0).toDate();
  }
}

// GET /api/daily?date=YYYY-MM-DD -> that day's list (created if missing) + undone items from previous days
router.get(
  '/',
  wrap(async (req, res) => {
    const date = req.query.date || today();
    const [docRaw, previous] = await Promise.all([
      getOrCreate(date),
      DailyTodo.find({ date: { $lt: date }, 'items.done': false }).sort({ date: -1 }).limit(14),
    ]);
    const doc = sortItems(docRaw);
    const pendingFromPrevious = previous.flatMap((d) =>
      d.items.filter((i) => !i.done).map((i) => ({ _id: i._id, text: i.text, date: d.date, scheduledAt: i.scheduledAt }))
    );
    res.json({ ...doc.toObject(), pendingFromPrevious });
  })
);

// Recent history strip
router.get(
  '/history',
  wrap(async (req, res) => {
    const days = Number(req.query.days) || 14;
    const from = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
    const docs = await DailyTodo.find({ date: { $gte: from } }).sort({ date: -1 });
    res.json(
      docs.map((d) => ({
        date: d.date,
        total: d.items.length,
        done: d.items.filter((i) => i.done).length,
        focus: d.focus,
      }))
    );
  })
);

router.put(
  '/:date',
  wrap(async (req, res) => {
    const doc = await getOrCreate(req.params.date);
    if (req.body.focus !== undefined) doc.focus = req.body.focus;
    await doc.save();
    res.json(doc);
  })
);

// Add an item. Body: { text, scheduledAt?, remindBefore? }
router.post(
  '/:date/items',
  wrap(async (req, res) => {
    const doc = await getOrCreate(req.params.date);
    const item = { text: req.body.text, order: doc.items.length };
    doc.items.push(item);
    applySchedule(doc.items[doc.items.length - 1], req.body, req.params.date);
    await doc.save();
    res.status(201).json(sortItems(doc));
  })
);

router.patch(
  '/:date/items/:itemId',
  wrap(async (req, res) => {
    const doc = await getOrCreate(req.params.date);
    const item = doc.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (req.body.text !== undefined) item.text = req.body.text;
    if (req.body.done !== undefined) {
      item.done = Boolean(req.body.done);
      item.doneAt = item.done ? new Date() : undefined;
    }
    applySchedule(item, req.body, req.params.date);
    await doc.save();
    res.json(sortItems(doc));
  })
);

// Move an item to another day (keeps its time of day, re-arms the reminder)
router.post(
  '/:date/items/:itemId/move',
  wrap(async (req, res) => {
    const { toDate } = req.body;
    if (!isDate(toDate || '')) return res.status(400).json({ error: 'toDate required (YYYY-MM-DD)' });
    const from = await getOrCreate(req.params.date);
    const item = from.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (toDate === req.params.date) return res.json(sortItems(from));
    const to = await getOrCreate(toDate);
    const copy = item.toObject();
    delete copy._id;
    copy.carriedFrom = copy.carriedFrom || req.params.date;
    copy.reminderSentAt = undefined;
    if (copy.scheduledAt) {
      const t = dayjs(copy.scheduledAt);
      copy.scheduledAt = dayjs(toDate).hour(t.hour()).minute(t.minute()).second(0).toDate();
    }
    to.items.push(copy);
    from.items.pull(item._id);
    await Promise.all([from.save(), to.save()]);
    res.json(sortItems(from));
  })
);

router.delete(
  '/:date/items/:itemId',
  wrap(async (req, res) => {
    const doc = await getOrCreate(req.params.date);
    doc.items.pull(req.params.itemId);
    await doc.save();
    res.json(sortItems(doc));
  })
);

// Carry over undone items from previous days into this date (moves them; keeps time of day)
router.post(
  '/:date/carryover',
  wrap(async (req, res) => {
    const date = req.params.date;
    const ids = Array.isArray(req.body.itemIds) ? req.body.itemIds.map(String) : null;
    const doc = await getOrCreate(date);
    const previous = await DailyTodo.find({ date: { $lt: date }, 'items.done': false });
    for (const prev of previous) {
      const toMove = prev.items.filter((i) => !i.done && (!ids || ids.includes(String(i._id))));
      for (const item of toMove) {
        const copy = item.toObject();
        delete copy._id;
        copy.carriedFrom = copy.carriedFrom || prev.date;
        copy.reminderSentAt = undefined;
        copy.order = doc.items.length;
        if (copy.scheduledAt) {
          const t = dayjs(copy.scheduledAt);
          copy.scheduledAt = dayjs(date).hour(t.hour()).minute(t.minute()).second(0).toDate();
        }
        doc.items.push(copy);
        prev.items.pull(item._id);
      }
      if (toMove.length) await prev.save();
    }
    await doc.save();
    res.json(sortItems(doc));
  })
);

module.exports = router;
