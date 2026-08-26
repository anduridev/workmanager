const router = require('express').Router();
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Task = require('../models/Task');
const wrap = require('../middleware/asyncHandler');
const azdo = require('../services/azdo');

// List projects with task counts per status
router.get(
  '/',
  wrap(async (req, res) => {
    const [projects, counts] = await Promise.all([
      Project.find().sort({ name: 1 }).lean(),
      Task.aggregate([
        { $match: { project: { $ne: null } } },
        { $group: { _id: { project: '$project', status: '$status' }, n: { $sum: 1 } } },
      ]),
    ]);
    const byProject = {};
    counts.forEach((c) => {
      const key = String(c._id.project);
      byProject[key] = byProject[key] || { todo: 0, inprogress: 0, hold: 0, done: 0, total: 0 };
      byProject[key][c._id.status] = c.n;
      byProject[key].total += c.n;
    });
    res.json(projects.map((p) => ({ ...p, counts: byProject[String(p._id)] || { todo: 0, inprogress: 0, hold: 0, done: 0, total: 0 } })));
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    try {
      const project = await Project.create(pick(req.body));
      azdo.queueProject(project._id);
      res.status(201).json(project);
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ error: 'A project with that name already exists' });
      throw e;
    }
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    try {
      const project = await Project.findByIdAndUpdate(req.params.id, pick(req.body), { new: true, runValidators: true });
      if (!project) return res.status(404).json({ error: 'Project not found' });
      azdo.queueProject(project._id);
      res.json(project);
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ error: 'A project with that name already exists' });
      throw e;
    }
  })
);

// Delete a project; its tasks are kept but unlinked (unless ?deleteTasks=true)
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = new mongoose.Types.ObjectId(req.params.id);
    await Project.findByIdAndDelete(id);
    if (req.query.deleteTasks === 'true') await Task.deleteMany({ project: id });
    else {
      const affected = await Task.find({ project: id }).select('_id');
      await Task.updateMany({ project: id }, { $unset: { project: 1 } });
      affected.forEach((t) => azdo.queueTask(t._id)); // un-parent in Azure DevOps
    }
    res.json({ ok: true });
  })
);

function pick(body) {
  const out = {};
  ['name', 'description'].forEach((k) => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  return out;
}

module.exports = router;
