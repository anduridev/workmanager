/**
 * Zendesk Support integration (read tickets by client, update status/assignee, SLA per client).
 * Configured purely by env vars:
 *   ZENDESK_SUBDOMAIN  e.g. "acme" for acme.zendesk.com   (or ZENDESK_URL for a full base url)
 *   ZENDESK_EMAIL      the agent/admin email the API token belongs to
 *   ZENDESK_API_TOKEN  Admin Center → Apps and integrations → APIs → Zendesk API → token
 */

function config() {
  const sub = (process.env.ZENDESK_SUBDOMAIN || '').trim();
  return {
    url: ((process.env.ZENDESK_URL || '').trim() || (sub ? `https://${sub}.zendesk.com` : '')).replace(/\/+$/, ''),
    email: (process.env.ZENDESK_EMAIL || '').trim(),
    token: (process.env.ZENDESK_API_TOKEN || process.env.ZENDESK_TOKEN || '').trim(),
  };
}
const enabled = () => {
  const c = config();
  return Boolean(c.url && c.email && c.token);
};

async function request(method, path, body) {
  const c = config();
  const res = await fetch(`${c.url}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.email}/token:${c.token}`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const detail = data.description || data.error?.title || data.error || res.statusText;
    const err = new Error(`Zendesk ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Follow next_page links, collecting `key` from every page (safety-capped). */
async function paged(path, key, { maxPages = 5 } = {}) {
  const out = [];
  let url = path;
  for (let i = 0; i < maxPages && url; i++) {
    const data = await request('GET', url);
    out.push(...(data[key] || []));
    url = data.next_page ? data.next_page.replace(config().url, '') : null;
  }
  return out;
}

// ---------- cached lookups (orgs, agents, SLA policies) ----------
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // name -> { at, key, value }
async function cached(name, fn) {
  const c = config();
  const key = `${c.url}|${c.email}`;
  const hit = cache.get(name);
  if (hit && hit.key === key && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(name, { at: Date.now(), key, value });
  return value;
}
const clearCache = () => cache.clear();

/** Clients = Zendesk organizations. */
const organizations = () =>
  cached('orgs', async () => {
    const orgs = await paged('/api/v2/organizations.json?per_page=100', 'organizations');
    return orgs.map((o) => ({ id: o.id, name: o.name })).sort((a, b) => a.name.localeCompare(b.name));
  });

/** Assignable people = agents + admins. */
const agents = () =>
  cached('agents', async () => {
    const users = await paged('/api/v2/users.json?role[]=agent&role[]=admin&per_page=100', 'users');
    return users.map((u) => ({ id: u.id, name: u.name, email: u.email })).sort((a, b) => a.name.localeCompare(b.name));
  });

/** SLA policies with their filter conditions and metric targets. */
const slaPolicies = () =>
  cached('slas', async () => {
    try {
      const data = await request('GET', '/api/v2/slas/policies.json');
      return (data.sla_policies || []).map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description || '',
        conditions: [...(p.filter?.all || []).map((f) => ({ ...f, mode: 'all' })), ...(p.filter?.any || []).map((f) => ({ ...f, mode: 'any' }))],
        metrics: (p.policy_metrics || []).map((m) => ({ priority: m.priority, metric: m.metric, targetMinutes: m.target, businessHours: Boolean(m.business_hours) })),
      }));
    } catch (e) {
      if (e.status === 403 || e.status === 404) return []; // plan without SLA policies
      throw e;
    }
  });

/** Policies that apply to an organization (org condition matches, or no org condition at all). */
function policiesForOrg(policies, orgId) {
  return policies.filter((p) => {
    const orgConds = p.conditions.filter((f) => f.field === 'organization_id');
    if (!orgConds.length) return true;
    return orgConds.some((f) => String(f.value) === String(orgId) || (Array.isArray(f.value) && f.value.map(String).includes(String(orgId))));
  });
}

// ---------- tickets ----------
const nameOf = (users, id) => users.find((u) => u.id === id)?.name || null;

/** Nearest active SLA breach on a ticket (from the `slas` side-load). */
function nextBreach(t) {
  const ms = (t.slas?.policy_metrics || []).filter((m) => m.breach_at && m.stage === 'active');
  if (!ms.length) return null;
  const next = ms.sort((a, b) => new Date(a.breach_at) - new Date(b.breach_at))[0];
  return { metric: next.metric, breachAt: next.breach_at, stage: next.stage };
}

/**
 * Tickets, newest-updated first, optionally for one organization.
 * Side-loads users (names) and slas (active breach targets).
 */
async function tickets({ orgId, status, q, limit = 200 } = {}) {
  const base = orgId ? `/api/v2/organizations/${orgId}/tickets.json` : '/api/v2/tickets.json';
  const raw = await paged(`${base}?include=slas,users&per_page=100&sort_by=updated_at&sort_order=desc`, 'tickets', { maxPages: Math.ceil(limit / 100) });
  // side-loaded users arrive per page; collect them all again in one map
  const userIds = new Set();
  raw.forEach((t) => {
    if (t.requester_id) userIds.add(t.requester_id);
    if (t.assignee_id) userIds.add(t.assignee_id);
  });
  let users = [];
  const ids = [...userIds].slice(0, 100);
  if (ids.length) {
    try {
      users = (await request('GET', `/api/v2/users/show_many.json?ids=${ids.join(',')}`)).users || [];
    } catch {
      users = [];
    }
  }
  let list = raw.map((t) => ({
    id: t.id,
    subject: t.subject || '(no subject)',
    status: t.status,
    priority: t.priority || null,
    type: t.type || null,
    organizationId: t.organization_id || null,
    requester: t.requester_id ? { id: t.requester_id, name: nameOf(users, t.requester_id) || `#${t.requester_id}` } : null,
    assignee: t.assignee_id ? { id: t.assignee_id, name: nameOf(users, t.assignee_id) || `#${t.assignee_id}` } : null,
    tags: t.tags || [],
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    url: `${config().url}/agent/tickets/${t.id}`,
    sla: nextBreach(t),
  }));
  if (status) list = list.filter((t) => t.status === status);
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    list = list.filter((t) => rx.test(t.subject) || rx.test(String(t.id)) || rx.test(t.requester?.name || '') || rx.test(t.assignee?.name || ''));
  }
  return list.slice(0, limit);
}

/** Full ticket with its conversation (public replies + internal notes) and attachments. */
async function ticket(id) {
  const [tRes, cRes] = await Promise.all([request('GET', `/api/v2/tickets/${id}.json`), request('GET', `/api/v2/tickets/${id}/comments.json?include=users&per_page=100`)]);
  const t = tRes.ticket;
  let users = cRes.users || [];
  const missing = [t.requester_id, t.assignee_id].filter(Boolean).filter((x) => !users.some((u) => u.id === x));
  if (missing.length) {
    try {
      users = users.concat((await request('GET', `/api/v2/users/show_many.json?ids=${missing.join(',')}`)).users || []);
    } catch {}
  }
  const who = (uid) => users.find((u) => u.id === uid) || null;
  return {
    id: t.id,
    subject: t.subject || '(no subject)',
    status: t.status,
    priority: t.priority || null,
    type: t.type || null,
    organizationId: t.organization_id || null,
    tags: t.tags || [],
    requester: t.requester_id ? { id: t.requester_id, name: who(t.requester_id)?.name || `#${t.requester_id}`, email: who(t.requester_id)?.email || '' } : null,
    assignee: t.assignee_id ? { id: t.assignee_id, name: who(t.assignee_id)?.name || `#${t.assignee_id}` } : null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    url: `${config().url}/agent/tickets/${t.id}`,
    comments: (cRes.comments || []).map((c) => ({
      id: c.id,
      body: c.body || '',
      public: c.public !== false,
      author: who(c.author_id)?.name || `#${c.author_id}`,
      agent: ['agent', 'admin'].includes(who(c.author_id)?.role || ''),
      createdAt: c.created_at,
      attachments: (c.attachments || []).map((a) => ({ name: a.file_name, url: a.content_url, size: a.size || 0, contentType: a.content_type || '', thumb: a.thumbnails?.[0]?.content_url || '' })),
    })),
  };
}

/** End-users of an organization (requester picker when creating a ticket). */
async function orgUsers(orgId) {
  const users = await paged(`/api/v2/organizations/${orgId}/users.json?per_page=100`, 'users', { maxPages: 2 });
  return users.map((u) => ({ id: u.id, name: u.name, email: u.email || '', role: u.role })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Create a ticket (requester by id, or by email — Zendesk creates the user if new). */
async function createTicket({ subject, body, requesterId, requesterName, requesterEmail, orgId, priority, type, assigneeId }) {
  const ticket = { subject, comment: { body } };
  if (requesterId) ticket.requester_id = Number(requesterId);
  else if (requesterEmail) ticket.requester = { name: requesterName || requesterEmail, email: requesterEmail };
  if (orgId) ticket.organization_id = Number(orgId);
  if (priority) ticket.priority = priority;
  if (type) ticket.type = type;
  if (assigneeId) ticket.assignee_id = Number(assigneeId);
  return (await request('POST', '/api/v2/tickets.json', { ticket })).ticket;
}

/** Update status / assignee / priority / type / tags, optionally adding a reply or internal note. Closed tickets are refused by Zendesk. */
async function updateTicket(id, { status, assigneeId, priority, type, tags, comment } = {}) {
  const ticket = {};
  if (status !== undefined) ticket.status = status;
  if (assigneeId !== undefined) ticket.assignee_id = assigneeId || null;
  if (priority !== undefined) ticket.priority = priority || null;
  if (type !== undefined) ticket.type = type || null;
  if (tags !== undefined) ticket.tags = tags;
  if (comment?.body) ticket.comment = { body: comment.body, public: comment.public !== false };
  if (!Object.keys(ticket).length) throw new Error('Nothing to update');
  const data = await request('PUT', `/api/v2/tickets/${id}.json`, { ticket });
  return data.ticket;
}

/** Connection check: who the token authenticates as. */
async function test() {
  const me = (await request('GET', '/api/v2/users/me.json')).user;
  if (!me?.id) throw new Error('Authenticated, but Zendesk returned no user — check ZENDESK_EMAIL and the API token');
  return { ok: true, user: { name: me.name, email: me.email, role: me.role }, url: config().url };
}

module.exports = { config, enabled, request, organizations, agents, slaPolicies, policiesForOrg, tickets, ticket, orgUsers, createTicket, updateTicket, test, clearCache };
