const router = require('express').Router();
const wrap = require('../middleware/asyncHandler');
const zd = require('../services/zendesk');

const STATUSES = ['new', 'open', 'pending', 'hold', 'solved', 'closed'];

router.use((req, res, next) => {
  if (!zd.enabled() && req.path !== '/status') return res.status(400).json({ error: 'Zendesk is not configured — set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL and ZENDESK_API_TOKEN on the server', notConfigured: true });
  next();
});

router.get(
  '/status',
  wrap(async (req, res) => {
    if (!zd.enabled()) return res.json({ enabled: false });
    try {
      res.json({ enabled: true, ...(await zd.test()) });
    } catch (e) {
      res.json({ enabled: true, ok: false, error: e.message, url: zd.config().url });
    }
  })
);

// Clients (organizations) and assignable agents
router.get(
  '/orgs',
  wrap(async (req, res) => {
    res.json(await zd.organizations());
  })
);
router.get(
  '/agents',
  wrap(async (req, res) => {
    res.json(await zd.agents());
  })
);

// Tickets: ?org=<id>&status=<new|open|pending|hold|solved|closed>&q=<search>
router.get(
  '/tickets',
  wrap(async (req, res) => {
    const { org, status, q } = req.query;
    res.json(await zd.tickets({ orgId: org || undefined, status: STATUSES.includes(status) ? status : undefined, q: q || undefined }));
  })
);

// Update status / assignee. body: { status?, assigneeId? } (assigneeId '' or null = unassign)
router.put(
  '/tickets/:id',
  wrap(async (req, res) => {
    const patch = {};
    if (req.body?.status !== undefined) {
      if (!STATUSES.includes(req.body.status) || req.body.status === 'closed') return res.status(400).json({ error: 'Status must be one of new, open, pending, hold, solved' });
      patch.status = req.body.status;
    }
    if (req.body?.assigneeId !== undefined) patch.assigneeId = req.body.assigneeId ? Number(req.body.assigneeId) : null;
    try {
      const t = await zd.updateTicket(req.params.id, patch);
      res.json({ ok: true, ticket: { id: t.id, status: t.status, assigneeId: t.assignee_id || null, updatedAt: t.updated_at } });
    } catch (e) {
      res.status(e.status === 404 ? 404 : 400).json({ error: e.message });
    }
  })
);

// All SLA policies (read-only screen)
router.get(
  '/policies',
  wrap(async (req, res) => {
    res.json(await zd.slaPolicies());
  })
);

// SLA view for a client: matching policies + live breach state of its open tickets. ?org=<id> (omit = all clients)
router.get(
  '/sla',
  wrap(async (req, res) => {
    const orgId = req.query.org || null;
    const [policies, list] = await Promise.all([zd.slaPolicies(), zd.tickets({ orgId: orgId || undefined })]);
    const open = list.filter((t) => !['solved', 'closed'].includes(t.status));
    const now = Date.now();
    const withSla = open.filter((t) => t.sla?.breachAt);
    const breached = withSla.filter((t) => new Date(t.sla.breachAt) < now);
    const atRisk = withSla.filter((t) => {
      const d = new Date(t.sla.breachAt) - now;
      return d >= 0 && d <= 4 * 60 * 60 * 1000; // breaching within 4h
    });
    res.json({
      policies: orgId ? zd.policiesForOrg(policies, orgId) : policies,
      live: {
        open: open.length,
        withSla: withSla.length,
        breached: breached.map((t) => ({ id: t.id, subject: t.subject, metric: t.sla.metric, breachAt: t.sla.breachAt })),
        atRisk: atRisk.map((t) => ({ id: t.id, subject: t.subject, metric: t.sla.metric, breachAt: t.sla.breachAt })),
      },
    });
  })
);

module.exports = router;
