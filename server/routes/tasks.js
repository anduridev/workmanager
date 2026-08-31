const router = require('express').Router();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const wrap = require('../middleware/asyncHandler');
const azdo = require('../services/azdo');

const POPULATE = { path: 'project', select: 'name' };

// List with filters: status, priority, project (id | "none"), tag, q (search)
router.get(
  '/',
  wrap(async (req, res) => {
    const { status, priority, project, tag, q, includeDone } = req.query;
    const filter = {};
    if (status) filter.status = { $in: status.split(',') };
    else if (includeDone !== 'true') filter.status = { $ne: 'done' };
    if (priority) filter.priority = priority;
    if (project === 'none') filter.project = null;
    else if (project && mongoose.isValidObjectId(project)) filter.project = project;
    if (tag) filter.tags = tag;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: rx }, { description: rx }, { 'notes.text': rx }];
    }
    const tasks = await Task.find(filter).populate(POPULATE).sort({ order: 1, updatedAt: -1 });
    res.json(tasks);
  })
);

router.get(
  '/meta',
  wrap(async (req, res) => {
    const tags = await Task.distinct('tags');
    res.json({ tags, statuses: Task.STATUSES, priorities: Task.PRIORITIES });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const body = pick(req.body);
    const ext = extPbi(req.body);
    if (ext) Object.assign(body, { project: null, azdo: { extParentId: ext.id, extParentTitle: ext.title } });
    const task = await Task.create({ ...body, statusHistory: [{ from: null, to: body.status || 'todo' }] });
    await task.populate(POPULATE);
    azdo.queueTask(task._id);
    res.status(201).json(task);
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const task = await Task.findById(req.params.id).populate(POPULATE);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const body = pick(req.body);
    if (body.status && body.status !== task.status) applyStatus(task, body.status);
    delete body.status;
    Object.assign(task, body);
    const ext = extPbi(req.body);
    if (ext) {
      task.project = null;
      task.set('azdo.extParentId', ext.id);
      task.set('azdo.extParentTitle', ext.title);
    } else if (ext === null || body.project) {
      task.set('azdo.extParentId', undefined);
      task.set('azdo.extParentTitle', undefined);
    }
    await task.save();
    await task.populate(POPULATE);
    azdo.queueTask(task._id);
    res.json(task);
  })
);

router.patch(
  '/:id/status',
  wrap(async (req, res) => {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    applyStatus(task, req.body.status);
    await task.save();
    await task.populate(POPULATE);
    azdo.queueTask(task._id);
    res.json(task);
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

// Notes on a task (each note is timestamped)
router.post(
  '/:id/notes',
  wrap(async (req, res) => {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    task.notes.push({ text: req.body.text });
    await task.save();
    await task.populate(POPULATE);
    azdo.queueNote(task._id, req.body.text);
    res.status(201).json(task);
  })
);

router.put(
  '/:id/notes/:noteId',
  wrap(async (req, res) => {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const note = task.notes.id(req.params.noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    note.text = req.body.text;
    await task.save();
    await task.populate(POPULATE);
    res.json(task);
  })
);

router.delete(
  '/:id/notes/:noteId',
  wrap(async (req, res) => {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    task.notes.pull(req.params.noteId);
    await task.save();
    await task.populate(POPULATE);
    res.json(task);
  })
);

function applyStatus(task, status) {
  if (!Task.STATUSES.includes(status)) {
    const err = new Error('Invalid status');
    err.status = 400;
    throw err;
  }
  if (status === task.status) return;
  task.statusHistory.push({ from: task.status, to: status, at: new Date() });
  task.status = status;
  task.completedAt = status === 'done' ? new Date() : undefined;
}

function pick(body) {
  const out = {};
  ['title', 'description', 'status', 'priority', 'project', 'tags', 'dueDate', 'order'].forEach((k) => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  if (out.dueDate === '') out.dueDate = null;
  if (out.project !== undefined) {
    // accept an id, a populated object, or empty -> no project
    if (out.project && typeof out.project === 'object') out.project = out.project._id;
    if (!out.project || !mongoose.isValidObjectId(out.project)) out.project = null;
  }
  if (typeof out.tags === 'string') out.tags = out.tags.split(',').map((t) => t.trim()).filter(Boolean);
  return out;
}

/** body.extPbi: undefined = leave as is, null = unlink, { id, title } = attach to that existing sprint PBI. */
function extPbi(body) {
  if (body.extPbi === undefined) return undefined;
  const id = Number(body.extPbi?.id);
  return id > 0 ? { id, title: String(body.extPbi.title || '').slice(0, 300) } : null;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
