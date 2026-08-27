const router = require('express').Router();
const azdo = require('../services/azdo');
const wrap = require('../middleware/asyncHandler');

// Status of the Azure DevOps integration (config + live connection check + pending counts)
router.get(
  '/azdo',
  wrap(async (req, res) => {
    const c = azdo.config();
    const enabled = azdo.enabled();
    const [connection, pending] = await Promise.all([enabled ? azdo.testConnection({ fresh: req.query.fresh === '1' }) : null, azdo.pendingCounts()]);
    res.json({
      enabled,
      orgUrl: c.orgUrl,
      project: c.project,
      pbiType: c.pbiType,
      taskType: c.taskType,
      stateMap: c.stateMap,
      syncOrphans: c.syncOrphans,
      connection,
      pending,
    });
  })
);

router.post(
  '/azdo/sync-all',
  wrap(async (req, res) => {
    if (!azdo.enabled()) return res.status(400).json({ error: 'Azure DevOps is not configured' });
    const result = await azdo.syncAll({ force: req.body?.force === true });
    result.pull = await azdo.pullChanges();
    res.json(result);
  })
);

// Close PBIs whose sprint has ended (the scheduler does this every few minutes too)
router.post(
  '/azdo/close-ended-sprints',
  wrap(async (req, res) => {
    if (!azdo.enabled()) return res.status(400).json({ error: 'Azure DevOps is not configured' });
    res.json(await azdo.closeEndedSprintPbis());
  })
);

// Pull changes made in Azure DevOps / TFS (state, assignee, sprint) into WorkPA now
router.post(
  '/azdo/pull',
  wrap(async (req, res) => {
    if (!azdo.enabled()) return res.status(400).json({ error: 'Azure DevOps is not configured' });
    res.json(await azdo.pullChanges());
  })
);

router.post(
  '/azdo/sync/project/:id',
  wrap(async (req, res) => {
    if (!azdo.enabled()) return res.status(400).json({ error: 'Azure DevOps is not configured' });
    // Also the "Create PBI now" action for projects created with "create later"
    const p = await azdo.createPbiNow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Work item not found' });
    res.json(p);
  })
);

router.post(
  '/azdo/sync/task/:id',
  wrap(async (req, res) => {
    if (!azdo.enabled()) return res.status(400).json({ error: 'Azure DevOps is not configured' });
    const t = await azdo.syncTask(req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    await t.populate('project', 'name');
    res.json(t);
  })
);

module.exports = router;
