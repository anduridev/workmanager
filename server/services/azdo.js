/**
 * Azure DevOps / TFS sync.
 *   WorkPA Project -> Product Backlog Item (PBI), placed in the current sprint at creation (optional: "create later")
 *                     One PBI per sprint: when the sprint ends the PBI is moved to Done, and the next task created
 *                     for the project gets a fresh PBI in the current sprint (open tasks are carried over to it).
 *   WorkPA Task    -> Task, child of the project's PBI, placed in the sprint containing the task date
 *                     (due date, or creation date when there is no due date)
 *   Task status    -> System.State (mapping configurable), "hold" adds an "On Hold" tag
 *   Task notes     -> discussion entries (System.History) — works on cloud and every TFS version
 *
 * Works with Azure DevOps Services and on-prem TFS / Azure DevOps Server (the REST api-version is auto-detected).
 *
 * Config (env): AZDO_ORG_URL (https://dev.azure.com/<org> or http://server:8080/tfs/DefaultCollection),
 *   AZDO_PROJECT, AZDO_PAT (or AZDO_USERNAME + AZDO_PASSWORD for basic auth),
 *   AZDO_PBI_TYPE (default "Product Backlog Item"), AZDO_TASK_TYPE (default "Task"),
 *   AZDO_STATE_MAP (JSON, default Scrum states), AZDO_AREA_PATH, AZDO_ITERATION_PATH (fallback when no sprint matches),
 *   AZDO_SPRINT_BY_DATE (default true), AZDO_API_VERSION (optional pin), AZDO_SYNC_ORPHAN_TASKS (default true).
 */
const dayjs = require('dayjs');

const STATUS_LABEL = { todo: 'To Do', inprogress: 'In Progress', hold: 'On Hold', done: 'Done' };
const PRIORITY = { urgent: 1, high: 2, medium: 3, low: 4 };
const HOLD_TAG = 'On Hold';
const APP_TAG = 'WorkPA';
const API_CANDIDATES = ['7.1', '7.0', '6.0', '5.1', '5.0', '4.1', '4.0', '3.0'];

function parseJson(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function config() {
  return {
    orgUrl: (process.env.AZDO_ORG_URL || '').trim().replace(/\/+$/, ''),
    project: (process.env.AZDO_PROJECT || '').trim(),
    pat: (process.env.AZDO_PAT || '').trim(),
    username: (process.env.AZDO_USERNAME || '').trim(),
    password: (process.env.AZDO_PASSWORD || '').trim(),
    pbiType: process.env.AZDO_PBI_TYPE || 'Product Backlog Item',
    pbiState: (process.env.AZDO_PBI_STATE ?? 'Approved').trim(), // state for newly created PBIs ('' = leave the process default)
    pbiDoneState: (process.env.AZDO_PBI_DONE_STATE ?? 'Done').trim(), // state given to a PBI when its sprint ends ('' = never close)
    carryOver: process.env.AZDO_CARRY_OVER_OPEN_TASKS !== 'false', // re-parent open tasks under the new sprint's PBI
    taskType: process.env.AZDO_TASK_TYPE || 'Task',
    areaPath: process.env.AZDO_AREA_PATH || '',
    iterationPath: process.env.AZDO_ITERATION_PATH || '',
    sprintByDate: process.env.AZDO_SPRINT_BY_DATE !== 'false',
    assignTo: (process.env.AZDO_ASSIGN_TO || '').trim(), // identity string; empty = the PAT's own user
    placeOnTop: process.env.AZDO_PLACE_ON_TOP !== 'false', // new items go to the top of the sprint backlog
    apiVersion: (process.env.AZDO_API_VERSION || '').trim(),
    stateMap: { todo: 'To Do', inprogress: 'In Progress', hold: 'To Do', done: 'Done', ...parseJson(process.env.AZDO_STATE_MAP, {}) },
    syncOrphans: process.env.AZDO_SYNC_ORPHAN_TASKS !== 'false',
  };
}

const enabled = () => {
  const c = config();
  return Boolean(c.orgUrl && c.project && (c.pat || (c.username && c.password)));
};

function authHeader() {
  const c = config();
  const cred = c.pat ? `${c.username}:${c.pat}` : `${c.username}:${c.password}`;
  return 'Basic ' + Buffer.from(cred).toString('base64');
}

// ---------- API version detection (on-prem TFS servers only support older versions) ----------
let resolvedVersion = null;
let resolvedFor = '';

async function rawRequest(method, url, body, contentType) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: authHeader(), 'Content-Type': contentType || 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = parseJson(text, text);
  return { res, data };
}

function errorFrom(res, data) {
  const msg = (data && data.message) || (typeof data === 'string' ? data.replace(/<[^>]+>/g, ' ').trim().slice(0, 200) : res.statusText);
  const err = new Error(`Azure DevOps ${res.status}: ${msg}`);
  err.status = res.status;
  return err;
}

const isVersionError = (res, data) => res.status === 400 && /api-version|out of range|not supported/i.test(String(data?.message || data || ''));

async function apiVersion() {
  const c = config();
  if (c.apiVersion) return c.apiVersion;
  if (resolvedVersion && resolvedFor === c.orgUrl) return resolvedVersion;
  let lastErr = null;
  for (const v of API_CANDIDATES) {
    const { res, data } = await rawRequest('GET', `${c.orgUrl}/_apis/projects/${encodeURIComponent(c.project)}?api-version=${v}`);
    if (res.ok) {
      resolvedVersion = v;
      resolvedFor = c.orgUrl;
      console.log(`[azdo] using REST api-version ${v}`);
      return v;
    }
    lastErr = errorFrom(res, data);
    if (!isVersionError(res, data)) throw lastErr; // auth / not found / network — no point trying other versions
  }
  throw lastErr || new Error('Could not determine a supported Azure DevOps API version');
}

async function request(method, path, body, contentType) {
  const v = await apiVersion();
  const url = `${path}${path.includes('?') ? '&' : '?'}api-version=${v}`;
  const { res, data } = await rawRequest(method, url, body, contentType);
  if (!res.ok) throw errorFrom(res, data);
  return data;
}

const projectUrl = () => `${config().orgUrl}/${encodeURIComponent(config().project)}`;
const workItemHtmlUrl = (id) => `${projectUrl()}/_workitems/edit/${id}`;

async function createWorkItem(type, ops) {
  return request('POST', `${projectUrl()}/_apis/wit/workitems/$${encodeURIComponent(type)}`, ops, 'application/json-patch+json');
}
async function updateWorkItem(id, ops) {
  return request('PATCH', `${config().orgUrl}/_apis/wit/workitems/${id}`, ops, 'application/json-patch+json');
}
async function getWorkItem(id) {
  return request('GET', `${config().orgUrl}/_apis/wit/workitems/${id}?$expand=relations`);
}

// ---------- identity (who new work items are assigned to) ----------
let identityCache = { key: '', value: null };

/** Identity string for System.AssignedTo: AZDO_ASSIGN_TO, else the authenticated user ("Display Name <DOMAIN\\user>"). */
async function assignee() {
  const c = config();
  if (c.assignTo) return c.assignTo;
  const key = `${c.orgUrl}|${c.username}`;
  if (identityCache.key === key) return identityCache.value;
  let value = null;
  try {
    const { res, data } = await rawRequest('GET', `${c.orgUrl}/_apis/connectionData`);
    if (res.ok && data.authenticatedUser) {
      const u = data.authenticatedUser;
      const display = u.providerDisplayName || u.customDisplayName || '';
      const account = u.properties?.Account?.$value || '';
      // Prefer the configured DOMAIN\user (unique name); fall back to whatever the server reports
      const unique = c.username.includes('\\') ? c.username : account;
      value = display && unique ? `${display} <${unique}>` : display || unique || null;
    }
  } catch (e) {
    console.warn('[azdo] could not resolve identity:', e.message);
  }
  if (!value && c.username) value = c.username;
  identityCache = { key, value };
  if (value) console.log(`[azdo] new work items will be assigned to ${value}`);
  return value;
}

/** BacklogPriority that puts a new item at the top of the given iteration's backlog. */
async function topBacklogPriority(iterationPath, type) {
  const c = config();
  if (!c.placeOnTop || !iterationPath) return null;
  try {
    const q = await request('POST', `${projectUrl()}/_apis/wit/wiql`, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='${c.project.replace(/'/g, "''")}' AND [System.IterationPath]='${iterationPath.replace(/'/g, "''")}' AND [System.WorkItemType]='${type}' ORDER BY [Microsoft.VSTS.Common.BacklogPriority] ASC`,
    });
    const topId = q.workItems?.[0]?.id;
    if (!topId) return null;
    const top = await request('GET', `${c.orgUrl}/_apis/wit/workitems/${topId}?fields=Microsoft.VSTS.Common.BacklogPriority`);
    const p = top.fields?.['Microsoft.VSTS.Common.BacklogPriority'];
    return typeof p === 'number' ? p - 1 : null;
  } catch (e) {
    console.warn('[azdo] could not compute backlog position:', e.message);
    return null;
  }
}

// ---------- sprints ----------
let iterationCache = { at: 0, list: [], key: '' };

/** Flat list of iterations with dates: [{ path: "Digital Bank\\Sprint 12", start, finish, depth }]. Cached 10 min. */
async function getIterations() {
  const c = config();
  const key = `${c.orgUrl}|${c.project}`;
  if (iterationCache.key === key && Date.now() - iterationCache.at < 10 * 60 * 1000) return iterationCache.list;
  const root = await request('GET', `${projectUrl()}/_apis/wit/classificationnodes/Iterations?$depth=10`);
  const list = [];
  const walk = (node, names, depth) => {
    const path = [...names, node.name];
    const a = node.attributes || {};
    if (a.startDate && a.finishDate) list.push({ path: path.join('\\'), start: dayjs(a.startDate), finish: dayjs(a.finishDate).endOf('day'), depth });
    (node.children || []).forEach((ch) => walk(ch, path, depth + 1));
  };
  walk(root, [], 0);
  iterationCache = { at: Date.now(), list, key };
  return list;
}

/** Iteration path for a date: the deepest sprint whose range contains it; else the env fallback; else null (project default). */
async function iterationFor(date) {
  const c = config();
  if (!c.sprintByDate) return c.iterationPath || null;
  const d = dayjs(date || new Date());
  try {
    const list = await getIterations();
    // 1) a sprint whose date range contains the date (deepest wins)
    const hit = list.filter((it) => !d.isBefore(it.start) && !d.isAfter(it.finish)).sort((a, b) => b.depth - a.depth)[0];
    if (hit) return hit.path;
    // 2) date falls in a short gap between sprints (e.g. a weekend) -> the next sprint
    const next = list.filter((it) => it.start.isAfter(d)).sort((a, b) => a.start - b.start)[0];
    if (next && next.start.diff(d, 'day') <= 7) return next.path;
    // 3) beyond the last defined sprint (or before the first) -> fallback / project backlog
  } catch (e) {
    console.warn('[azdo] could not load sprints:', e.message);
  }
  return c.iterationPath || null;
}

/** Sprint (iteration with dates) for an iteration path, from the cached list; null when unknown / no dates. */
async function sprintByPath(path) {
  if (!path) return null;
  try {
    const list = await getIterations();
    return list.find((it) => it.path === path) || null;
  } catch {
    return null;
  }
}

const CLOSED_STATES = ['Done', 'Closed', 'Removed', 'Completed', 'Resolved'];
/** True when the project's current PBI is in a closed state (as last seen from TFS or set by us). */
function pbiClosed(project) {
  const st = project.azdo?.state;
  return Boolean(st && (st === config().pbiDoneState || CLOSED_STATES.includes(st)));
}

let sprintPbiCache = { at: 0, key: '', value: null };

/** Open PBIs in the sprint covering today — for "attach this task to an existing PBI". Cached 60s. */
async function listSprintPbis() {
  if (!enabled()) return { enabled: false, sprint: null, pbis: [] };
  const c = config();
  const sprint = await iterationFor(new Date());
  if (!sprint) return { enabled: true, sprint: null, pbis: [] };
  const key = `${c.orgUrl}|${c.project}|${sprint}|${c.pbiType}`;
  if (sprintPbiCache.key === key && Date.now() - sprintPbiCache.at < 60 * 1000) return sprintPbiCache.value;
  const q = await request('POST', `${projectUrl()}/_apis/wit/wiql`, {
    query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='${c.project.replace(/'/g, "''")}' AND [System.IterationPath]='${sprint.replace(/'/g, "''")}' AND [System.WorkItemType]='${c.pbiType.replace(/'/g, "''")}' ORDER BY [Microsoft.VSTS.Common.BacklogPriority] ASC`,
  });
  const ids = (q.workItems || []).map((w) => w.id).slice(0, 100);
  let pbis = [];
  if (ids.length) {
    const d = await request('GET', `${c.orgUrl}/_apis/wit/workitems?ids=${ids.join(',')}&fields=${encodeURIComponent('System.Id,System.Title,System.State')}`);
    pbis = (d.value || [])
      .filter((wi) => { const st = wi.fields?.['System.State']; return !CLOSED_STATES.includes(st) && st !== c.pbiDoneState; })
      .map((wi) => ({ id: wi.id, title: wi.fields?.['System.Title'] || `#${wi.id}`, state: wi.fields?.['System.State'] || '', url: workItemHtmlUrl(wi.id) }));
  }
  const value = { enabled: true, sprint, pbis };
  sprintPbiCache = { at: Date.now(), key, value };
  return value;
}

/** True when the project's current PBI belongs to a sprint that has already finished. */
async function pbiSprintEnded(project, now = dayjs()) {
  const sp = await sprintByPath(project.azdo?.iterationPath);
  return Boolean(sp && now.isAfter(sp.finish));
}

/** Connection check + validation of the state mapping + sprint overview (for the status card). Cached 5 min. */
let statusCache = { key: '', at: 0, value: null };
async function testConnection({ fresh = false } = {}) {
  const c = config();
  const key = `${c.orgUrl}|${c.project}|${c.taskType}|${c.pbiType}|${c.pbiState}`;
  if (!fresh && statusCache.key === key && statusCache.value?.ok && Date.now() - statusCache.at < 5 * 60 * 1000) return statusCache.value;
  const value = await testConnectionUncached();
  statusCache = { key, at: Date.now(), value };
  return value;
}

async function testConnectionUncached() {
  const c = config();
  if (!enabled()) return { ok: false, error: 'Not configured (AZDO_ORG_URL, AZDO_PROJECT, AZDO_PAT)' };
  try {
    const v = await apiVersion();
    const proj = await request('GET', `${c.orgUrl}/_apis/projects/${encodeURIComponent(c.project)}`);
    const warnings = [];
    try {
      const states = await request('GET', `${projectUrl()}/_apis/wit/workitemtypes/${encodeURIComponent(c.taskType)}/states`);
      const names = (states.value || []).map((s) => s.name);
      Object.entries(c.stateMap).forEach(([k, val]) => {
        if (names.length && !names.includes(val)) warnings.push(`State "${val}" (for ${STATUS_LABEL[k]}) is not a valid "${c.taskType}" state. Valid: ${names.join(', ')}`);
      });
    } catch (e) {
      /* older servers don't expose /states — mapping will be validated when the first task syncs */
    }
    if (c.pbiState) {
      try {
        const states = await request('GET', `${projectUrl()}/_apis/wit/workitemtypes/${encodeURIComponent(c.pbiType)}/states`);
        const names = (states.value || []).map((s) => s.name);
        if (names.length && !names.includes(c.pbiState)) warnings.push(`AZDO_PBI_STATE "${c.pbiState}" is not a valid "${c.pbiType}" state. Valid: ${names.join(', ')}`);
      } catch (e) {
        /* ignore */
      }
    }
    let currentSprint = null;
    let currentSprintEnds = null;
    let sprintCount = 0;
    if (c.sprintByDate) {
      try {
        const list = await getIterations();
        sprintCount = list.length;
        currentSprint = await iterationFor(new Date());
        const sp = list.find((it) => it.path === currentSprint);
        if (sp) currentSprintEnds = sp.finish.toDate();
        if (!sprintCount) warnings.push('No sprints with dates found — work items will use the project default iteration');
        else if (!currentSprint) warnings.push('No sprint covers today — items dated now will use the project default iteration');
      } catch (e) {
        warnings.push(`Could not read sprints: ${e.message}`);
      }
    }
    const assignedTo = await assignee();
    return { ok: true, projectName: proj.name, projectId: proj.id, apiVersion: v, currentSprint, currentSprintEnds, sprintCount, assignedTo, pbiDoneState: c.pbiDoneState, carryOver: c.carryOver, warnings };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- field builders ----------
const html = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

const op = (path, value) => ({ op: 'add', path: `/fields/${path}`, value });

function commonOps(iteration) {
  const c = config();
  const ops = [];
  if (c.areaPath) ops.push(op('System.AreaPath', c.areaPath));
  if (iteration) ops.push(op('System.IterationPath', iteration));
  return ops;
}

/** Fields that are only set when a work item is first created (assignee, backlog position). */
async function creationOps(iteration, type) {
  const ops = [];
  const who = await assignee();
  if (who) ops.push(op('System.AssignedTo', who));
  const prio = await topBacklogPriority(iteration, type);
  if (prio !== null) ops.push(op('Microsoft.VSTS.Common.BacklogPriority', prio));
  return ops;
}

async function projectOps(project, { create }) {
  // Sprint is set when the PBI is created (current sprint); later edits leave whatever it has in ADO
  const iteration = create ? await iterationFor(new Date()) : null;
  const ops = [op('System.Title', project.name), op('System.Description', html(project.description)), op('System.Tags', APP_TAG), ...commonOps(iteration)];
  if (create) ops.push(...(await creationOps(iteration, config().pbiType)));
  return { iteration, ops };
}

const taskDate = (task) => task.dueDate || task.createdAt || new Date();

async function taskOps(task, { create }) {
  const tags = [APP_TAG, ...(task.tags || [])];
  if (task.status === 'hold') tags.push(HOLD_TAG);
  const desc = [task.description, task.dueDate && `Due: ${dayjs(task.dueDate).format('DD MMM YYYY')}`].filter(Boolean).join('\n\n');
  // Sprint: computed from the due date on create, and again only when the due date changes.
  // Otherwise TFS wins — if you drag the task to another sprint there, WorkPA leaves it alone.
  const dueChanged = String(task.dueDate || '') !== String(task.azdo?.dueDateSynced || '');
  const iteration = create || dueChanged || !task.azdo?.iterationPath ? await iterationFor(taskDate(task)) : null;
  const ops = [
    op('System.Title', task.title),
    op('System.Description', html(desc)),
    op('Microsoft.VSTS.Common.Priority', PRIORITY[task.priority] || 3),
    op('System.Tags', tags.join('; ')),
    ...commonOps(iteration),
  ];
  if (create) ops.push(...(await creationOps(iteration, config().taskType)));
  return { iteration, ops };
}

const parentLinkOp = (parentApiUrl) => ({
  op: 'add',
  path: '/relations/-',
  value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentApiUrl },
});

// ---------- sync operations ----------
function markOk(doc, wi, extra = {}) {
  doc.azdo = {
    ...(doc.azdo || {}),
    id: wi.id,
    url: workItemHtmlUrl(wi.id),
    apiUrl: wi.url,
    iterationPath: wi.fields?.['System.IterationPath'] || extra.iterationPath,
    syncedAt: new Date(),
    error: undefined,
    erroredAt: undefined,
    pendingSync: false,
    deferred: false,
    ...extra,
  };
}
function markErr(doc, e) {
  doc.azdo = { ...(doc.azdo || {}), error: e.message, erroredAt: new Date() };
}

/** Create/update the PBI for a project. Returns the saved project. */
async function syncProject(projectId) {
  if (!enabled()) return null;
  const Project = require('../models/Project');
  const project = await Project.findById(projectId);
  if (!project) return null;
  if (project.azdo?.deferred && !project.azdo?.id) {
    // "Create PBI later": nothing to push until the user asks (createPbiNow)
    if (project.azdo.pendingSync) await Project.updateOne({ _id: project._id }, { $set: { 'azdo.pendingSync': false } });
    return project;
  }
  try {
    const create = !project.azdo?.id;
    const { ops, iteration } = await projectOps(project, { create });
    let wi = create ? await createWorkItem(config().pbiType, ops) : await updateWorkItem(project.azdo.id, ops);
    // New PBIs start in the process's initial state (New); move them to the configured state (Approved)
    const wanted = config().pbiState;
    if (create && wanted && wi.fields?.['System.State'] !== wanted) wi = await updateWorkItem(wi.id, [op('System.State', wanted)]);
    markOk(project, wi, { iterationPath: iteration || project.azdo?.iterationPath, state: wi.fields?.['System.State'], rev: wi.rev });
  } catch (e) {
    markErr(project, e);
    console.warn(`[azdo] project "${project.name}": ${e.message}`);
  }
  await project.save();
  return project;
}

// ---------- one PBI per sprint ----------
/** Move the project's PBI to the configured done state (sprint ended). Idempotent. */
async function closePbi(project, reason = 'sprint ended') {
  const wanted = config().pbiDoneState;
  if (!project.azdo?.id || !wanted || pbiClosed(project)) return project;
  const wi = await updateWorkItem(project.azdo.id, [op('System.State', wanted)]);
  project.azdo.state = wi.fields?.['System.State'] || wanted;
  project.azdo.rev = wi.rev;
  project.azdo.closedAt = new Date();
  project.azdo.closedReason = reason;
  await project.save();
  console.log(`[azdo] PBI #${project.azdo.id} (${project.name}) -> ${project.azdo.state}: ${reason}`);
  return project;
}

/**
 * Re-parent the project's open tasks under its new PBI. Tasks still sitting in the old sprint are moved to the
 * current sprint as well (carry-over); tasks already in a later sprint keep theirs.
 */
async function carryOverTasks(project, oldIterationPath) {
  const Task = require('../models/Task');
  const open = await Task.find({ project: project._id, status: { $ne: 'done' }, 'azdo.id': { $exists: true } });
  let moved = 0;
  for (const t of open) {
    try {
      const current = await getWorkItem(t.azdo.id);
      const ops = [];
      const rels = current.relations || [];
      for (let i = rels.length - 1; i >= 0; i--) {
        if (rels[i].rel === 'System.LinkTypes.Hierarchy-Reverse') ops.push({ op: 'remove', path: `/relations/${i}` });
      }
      ops.push(parentLinkOp(project.azdo.apiUrl));
      const curIter = current.fields?.['System.IterationPath'];
      let iteration = null;
      if (!curIter || curIter === oldIterationPath) {
        iteration = await iterationFor(new Date());
        if (iteration) ops.push(op('System.IterationPath', iteration));
      }
      const wi = await updateWorkItem(t.azdo.id, ops);
      markOk(t, wi, { parentId: project.azdo.id, state: wi.fields?.['System.State'], iterationPath: wi.fields?.['System.IterationPath'] || iteration || curIter, rev: wi.rev, dueDateSynced: t.azdo.dueDateSynced });
      moved++;
    } catch (e) {
      markErr(t, e);
      console.warn(`[azdo] carry-over of "${t.title}": ${e.message}`);
    }
    await t.save();
  }
  if (moved) console.log(`[azdo] ${moved} open task(s) of "${project.name}" carried over to PBI #${project.azdo.id}`);
  return moved;
}

/**
 * Called before a *new* task is parented: if the project's PBI is in a sprint that has ended (or is already Done),
 * close it, archive it to azdoHistory and create a fresh PBI in the current sprint. Returns the (re)loaded project.
 */
async function ensureCurrentPbi(project) {
  if (!project.azdo?.id) return project;
  const ended = await pbiSprintEnded(project);
  if (!ended && !pbiClosed(project)) return project;
  if (!pbiClosed(project)) await closePbi(project, 'sprint ended');
  const old = project.toObject().azdo; // plain snapshot: the live nested object is cleared below
  project.azdoHistory = [
    ...(project.azdoHistory || []),
    { id: old.id, url: old.url, apiUrl: old.apiUrl, iterationPath: old.iterationPath, state: old.state, createdAt: old.syncedAt, closedAt: old.closedAt || new Date() },
  ];
  project.azdo = { deferred: false };
  project.markModified('azdo');
  await project.save();
  const fresh = await syncProject(project._id); // creates the new PBI in the current sprint
  if (fresh?.azdo?.id) {
    console.log(`[azdo] "${fresh.name}": new PBI #${fresh.azdo.id} in ${(fresh.azdo.iterationPath || '').split('\\').pop()} (previous #${old.id} closed)`);
    if (config().carryOver) await carryOverTasks(fresh, old.iterationPath);
  }
  return fresh;
}

/** Scheduler: PBIs whose sprint has finished are moved to Done (once; if you reopen it in TFS we leave it alone). */
async function closeEndedSprintPbis(now = dayjs()) {
  if (!enabled() || !config().pbiDoneState) return { closed: 0 };
  const Project = require('../models/Project');
  const projects = await Project.find({ 'azdo.id': { $exists: true }, 'azdo.iterationPath': { $exists: true, $ne: '' }, 'azdo.closedAt': { $exists: false } });
  let closed = 0;
  for (const p of projects) {
    if (pbiClosed(p)) continue;
    if (!(await pbiSprintEnded(p, now))) continue;
    try {
      await closePbi(p, 'sprint ended');
      closed++;
    } catch (e) {
      console.warn(`[azdo] closing PBI #${p.azdo.id} (${p.name}): ${e.message}`);
    }
  }
  return { closed };
}

/** "Create PBI later" -> now: clears the deferred flag, creates the PBI and pushes the project's waiting tasks. */
async function createPbiNow(projectId) {
  const Project = require('../models/Project');
  const Task = require('../models/Task');
  const project = await Project.findById(projectId);
  if (!project) return null;
  if (project.azdo?.deferred) {
    project.set('azdo.deferred', false);
    await project.save();
  }
  const synced = await syncProject(project._id);
  if (synced?.azdo?.id) {
    const waiting = await Task.find({ project: project._id, $or: [{ 'azdo.deferred': true }, { 'azdo.id': { $exists: false } }] }).select('_id');
    await Task.updateMany({ _id: { $in: waiting.map((t) => t._id) } }, { $set: { 'azdo.deferred': false, 'azdo.pendingSync': true } });
    waiting.forEach((t) => enqueue(() => syncTask(t._id)));
  }
  return synced;
}

/** Create/update the ADO Task for a task (and parent it under the project's PBI). */
async function syncTask(taskId) {
  if (!enabled()) return null;
  const Task = require('../models/Task');
  const Project = require('../models/Project');
  const task = await Task.findById(taskId);
  if (!task) return null;
  if (!task.project && !task.azdo?.extParentId && !config().syncOrphans && !task.azdo?.id) return task;
  try {
    let parent = null;
    if (task.project) {
      parent = await Project.findById(task.project);
      if (parent?.azdo?.deferred && !parent.azdo?.id) {
        // Project intentionally has no PBI yet -> its tasks wait too (pushed when the PBI is created)
        task.set('azdo.deferred', true);
        task.set('azdo.pendingSync', false);
        task.set('azdo.error', undefined);
        task.set('azdo.erroredAt', undefined);
        await task.save();
        return task;
      }
      if (parent && !parent.azdo?.id) parent = await syncProject(parent._id);
      else if (parent && !task.azdo?.id) parent = await ensureCurrentPbi(parent); // new task -> needs an open PBI in the current sprint
      if (parent && !parent.azdo?.id) throw new Error(`Work item "${parent.name}" is not synced to Azure DevOps yet (${parent.azdo?.error || 'unknown'})`);
    } else if (task.azdo?.extParentId) {
      // Attached to an existing sprint PBI: parent under it as-is (WorkPA never closes or rolls over that PBI)
      const pbi = await getWorkItem(task.azdo.extParentId);
      task.set('azdo.extParentTitle', pbi.fields?.['System.Title'] || task.azdo.extParentTitle);
      parent = { azdo: { id: pbi.id, apiUrl: pbi.url } };
    }
    const parentId = parent?.azdo?.id || null;
    const desiredState = config().stateMap[task.status];
    const { ops, iteration } = await taskOps(task, { create: !task.azdo?.id });

    let wi;
    if (!task.azdo?.id) {
      if (parentId) ops.push(parentLinkOp(parent.azdo.apiUrl));
      wi = await createWorkItem(config().taskType, ops);
      // State can only move away from the initial state after creation
      if (desiredState && wi.fields?.['System.State'] !== desiredState) wi = await updateWorkItem(wi.id, [op('System.State', desiredState)]);
    } else {
      if (desiredState) ops.push(op('System.State', desiredState));
      if ((task.azdo.parentId || null) !== parentId) {
        const current = await getWorkItem(task.azdo.id);
        const rels = current.relations || [];
        for (let i = rels.length - 1; i >= 0; i--) {
          if (rels[i].rel === 'System.LinkTypes.Hierarchy-Reverse') ops.push({ op: 'remove', path: `/relations/${i}` });
        }
        if (parentId) ops.push(parentLinkOp(parent.azdo.apiUrl));
      }
      wi = await updateWorkItem(task.azdo.id, ops);
    }
    markOk(task, wi, {
      parentId,
      state: wi.fields?.['System.State'],
      iterationPath: wi.fields?.['System.IterationPath'] || iteration || task.azdo?.iterationPath,
      assignedTo: identityName(wi.fields?.['System.AssignedTo']) || task.azdo?.assignedTo,
      dueDateSynced: task.dueDate || null,
      rev: wi.rev,
    });
  } catch (e) {
    markErr(task, e);
    console.warn(`[azdo] task "${task.title}": ${e.message}`);
  }
  await task.save();
  return task;
}

/** Post a task note into the work item's discussion (System.History). */
async function syncNote(taskId, text) {
  if (!enabled()) return;
  const Task = require('../models/Task');
  let task = await Task.findById(taskId);
  if (!task) return;
  if (!task.azdo?.id) task = await syncTask(taskId);
  if (!task?.azdo?.id) return;
  try {
    await updateWorkItem(task.azdo.id, [op('System.History', html(text))]);
  } catch (e) {
    console.warn(`[azdo] note on "${task.title}": ${e.message}`);
  }
}

/** Backfill: sync every project and task that is unsynced or errored (or everything with force). */
async function syncAll({ force = false, limit = 500 } = {}) {
  if (!enabled()) return { enabled: false };
  const Project = require('../models/Project');
  const Task = require('../models/Task');
  const need = force ? {} : NEEDS_SYNC;
  const projects = await Project.find(need).limit(limit);
  const tasks = await Task.find(need).limit(limit);
  const result = { enabled: true, projects: { synced: 0, failed: 0 }, tasks: { synced: 0, failed: 0 } };
  for (const p of projects) {
    const r = await syncProject(p._id);
    r?.azdo?.error ? result.projects.failed++ : result.projects.synced++;
  }
  for (const t of tasks) {
    const r = await syncTask(t._id);
    r?.azdo?.error ? result.tasks.failed++ : result.tasks.synced++;
  }
  return result;
}

/** Items that still need a push: never synced, last push failed, or changed locally since the last push. */
const NEEDS_SYNC = {
  $or: [{ 'azdo.id': { $exists: false }, 'azdo.deferred': { $ne: true } }, { 'azdo.error': { $exists: true, $ne: null } }, { 'azdo.pendingSync': true }],
};

async function pendingCounts() {
  const Project = require('../models/Project');
  const Task = require('../models/Task');
  const need = NEEDS_SYNC;
  const [projects, tasks, projectErrors, taskErrors] = await Promise.all([
    Project.countDocuments(need),
    Task.countDocuments(need),
    Project.countDocuments({ 'azdo.error': { $exists: true, $ne: null } }),
    Task.countDocuments({ 'azdo.error': { $exists: true, $ne: null } }),
  ]);
  return { projects, tasks, projectErrors, taskErrors };
}

// ---------- pull: bring changes made in TFS back into WorkPA ----------
const identityName = (v) => (v && typeof v === 'object' ? v.displayName || v.uniqueName : typeof v === 'string' ? v.replace(/\s*<.*>$/, '') : '');

/** Reverse state mapping: TFS state -> WorkPA status (hold is kept when TFS state is To Do and the On Hold tag is present). */
function statusFromState(state, tags, currentStatus) {
  const map = config().stateMap;
  if (map.done === state) return 'done';
  if (map.inprogress === state) return 'inprogress';
  if (map.todo === state) {
    if ((tags || '').split(';').map((s) => s.trim()).includes(HOLD_TAG)) return 'hold';
    return currentStatus === 'hold' && map.hold === state ? 'hold' : 'todo';
  }
  if (map.hold === state) return 'hold';
  return null; // unknown / Removed etc. -> leave local status alone
}

/**
 * Fetch every linked work item (batched) and apply remote changes locally:
 * - task state -> status (with a status-history entry and a notification)
 * - assignee / sprint / rev -> stored for display
 * Items with a local change still waiting to be pushed (pendingSync) are skipped — local wins until pushed.
 */
async function pullChanges() {
  if (!enabled()) return { enabled: false, changed: 0 };
  const Task = require('../models/Task');
  const Project = require('../models/Project');
  const { notify } = require('./notify');
  const fields = ['System.State', 'System.AssignedTo', 'System.IterationPath', 'System.Tags', 'System.Title', 'System.Rev', 'System.ChangedBy'].join(',');
  const c = config();

  const fetchBatch = async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const r = await request('GET', `${c.orgUrl}/_apis/wit/workitems?ids=${chunk.join(',')}&fields=${fields}&errorPolicy=omit`);
      out.push(...(r.value || []));
    }
    return out;
  };

  let changed = 0;
  // Tasks
  const tasks = await Task.find({ 'azdo.id': { $exists: true }, 'azdo.pendingSync': { $ne: true } }).select('title status tags azdo statusHistory completedAt');
  if (tasks.length) {
    const byId = new Map(tasks.map((t) => [t.azdo.id, t]));
    const items = await fetchBatch([...byId.keys()]);
    for (const wi of items) {
      const t = byId.get(wi.id);
      if (!t) continue;
      const f = wi.fields || {};
      const state = f['System.State'];
      const set = {
        'azdo.state': state,
        'azdo.assignedTo': identityName(f['System.AssignedTo']) || '',
        'azdo.iterationPath': f['System.IterationPath'],
        'azdo.rev': wi.rev,
        'azdo.pulledAt': new Date(),
      };
      const newStatus = statusFromState(state, f['System.Tags'], t.status);
      if (newStatus && newStatus !== t.status) {
        set.status = newStatus;
        set.completedAt = newStatus === 'done' ? new Date() : null;
        await Task.updateOne({ _id: t._id }, { $set: set, $push: { statusHistory: { from: t.status, to: newStatus, at: new Date(), source: 'tfs' } } });
        const by = identityName(f['System.ChangedBy']);
        await notify({
          kind: 'task',
          title: `TFS: ${t.title} → ${STATUS_LABEL[newStatus]}`,
          body: [`Work item #${wi.id} is now "${state}"`, by && `changed by ${by}`].filter(Boolean).join(' · '),
          refType: 'Task',
          refId: t._id,
          link: `/tasks/${t._id}`,
        });
        changed++;
      } else {
        await Task.updateOne({ _id: t._id }, { $set: set });
      }
    }
    // Linked items that TFS no longer returns (deleted/destroyed) -> flag so the badge shows it
    const returned = new Set(items.map((i) => i.id));
    for (const [id, t] of byId) {
      if (!returned.has(id)) await Task.updateOne({ _id: t._id }, { $set: { 'azdo.error': `Work item #${id} not found in TFS (deleted?)`, 'azdo.erroredAt': new Date() } });
    }
  }
  // Projects (PBIs): informational only — state, assignee, sprint
  const projects = await Project.find({ 'azdo.id': { $exists: true }, 'azdo.pendingSync': { $ne: true } }).select('name azdo');
  if (projects.length) {
    const byId = new Map(projects.map((p) => [p.azdo.id, p]));
    const items = await fetchBatch([...byId.keys()]);
    for (const wi of items) {
      const p = byId.get(wi.id);
      if (!p) continue;
      const f = wi.fields || {};
      await Project.updateOne(
        { _id: p._id },
        { $set: { 'azdo.state': f['System.State'], 'azdo.assignedTo': identityName(f['System.AssignedTo']) || '', 'azdo.iterationPath': f['System.IterationPath'], 'azdo.rev': wi.rev, 'azdo.pulledAt': new Date() } }
      );
    }
  }
  return { enabled: true, changed, tasks: tasks.length, projects: projects.length };
}

// ---------- fire-and-forget queue (serialised so parent creation / re-parenting stay ordered) ----------
let queue = Promise.resolve();
function enqueue(fn) {
  if (!enabled()) return;
  queue = queue.then(fn).catch((e) => console.warn('[azdo] queue error:', e.message));
}
/** Flag the document as changed *before* queueing, so a restart mid-queue is caught by the retry job. */
function markPending(Model, id) {
  return Model.updateOne({ _id: id }, { $set: { 'azdo.pendingSync': true } }).catch(() => {});
}
const queueProject = (id) => {
  if (!enabled()) return;
  markPending(require('../models/Project'), id).then(() => enqueue(() => syncProject(id)));
};
const queueTask = (id) => {
  if (!enabled()) return;
  markPending(require('../models/Task'), id).then(() => enqueue(() => syncTask(id)));
};
const queueNote = (id, text) => enqueue(() => syncNote(id, text));

module.exports = {
  config,
  enabled,
  testConnection,
  getIterations,
  iterationFor,
  sprintByPath,
  listSprintPbis,
  pbiClosed,
  closePbi,
  ensureCurrentPbi,
  closeEndedSprintPbis,
  createPbiNow,
  syncProject,
  syncTask,
  syncNote,
  syncAll,
  pullChanges,
  pendingCounts,
  queueProject,
  queueTask,
  queueNote,
  STATUS_LABEL,
};
