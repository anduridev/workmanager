/**
 * Azure DevOps / TFS sync.
 *   WorkPA Project -> Product Backlog Item (PBI), placed in the current sprint at creation
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
    let sprintCount = 0;
    if (c.sprintByDate) {
      try {
        const list = await getIterations();
        sprintCount = list.length;
        currentSprint = await iterationFor(new Date());
        if (!sprintCount) warnings.push('No sprints with dates found — work items will use the project default iteration');
        else if (!currentSprint) warnings.push('No sprint covers today — items dated now will use the project default iteration');
      } catch (e) {
        warnings.push(`Could not read sprints: ${e.message}`);
      }
    }
    const assignedTo = await assignee();
    return { ok: true, projectName: proj.name, projectId: proj.id, apiVersion: v, currentSprint, sprintCount, assignedTo, warnings };
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
  const iteration = await iterationFor(taskDate(task));
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
  try {
    const create = !project.azdo?.id;
    const { ops, iteration } = await projectOps(project, { create });
    let wi = create ? await createWorkItem(config().pbiType, ops) : await updateWorkItem(project.azdo.id, ops);
    // New PBIs start in the process's initial state (New); move them to the configured state (Approved)
    const wanted = config().pbiState;
    if (create && wanted && wi.fields?.['System.State'] !== wanted) wi = await updateWorkItem(wi.id, [op('System.State', wanted)]);
    markOk(project, wi, { iterationPath: iteration || project.azdo?.iterationPath, state: wi.fields?.['System.State'] });
  } catch (e) {
    markErr(project, e);
    console.warn(`[azdo] project "${project.name}": ${e.message}`);
  }
  await project.save();
  return project;
}

/** Create/update the ADO Task for a task (and parent it under the project's PBI). */
async function syncTask(taskId) {
  if (!enabled()) return null;
  const Task = require('../models/Task');
  const Project = require('../models/Project');
  const task = await Task.findById(taskId);
  if (!task) return null;
  if (!task.project && !config().syncOrphans && !task.azdo?.id) return task;
  try {
    let parent = null;
    if (task.project) {
      parent = await Project.findById(task.project);
      if (parent && !parent.azdo?.id) parent = await syncProject(parent._id);
      if (parent && !parent.azdo?.id) throw new Error(`Project "${parent.name}" is not synced to Azure DevOps yet (${parent.azdo?.error || 'unknown'})`);
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
    markOk(task, wi, { parentId, state: wi.fields?.['System.State'], iterationPath: wi.fields?.['System.IterationPath'] || iteration });
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
const NEEDS_SYNC = { $or: [{ 'azdo.id': { $exists: false } }, { 'azdo.error': { $exists: true, $ne: null } }, { 'azdo.pendingSync': true }] };

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
  syncProject,
  syncTask,
  syncNote,
  syncAll,
  pendingCounts,
  queueProject,
  queueTask,
  queueNote,
  STATUS_LABEL,
};
