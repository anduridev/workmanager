import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Projects as ProjectsApi, Integrations } from '../lib/api';
import { dayjs } from '../lib/date';
import { Empty, AzdoBadge } from '../components/ui';
import Modal from '../components/Modal';
import Menu from '../components/Menu';
import { FolderIcon, PlusIcon } from '../components/icons';
import { useToast } from '../components/Toast';
import { useIsMobile } from '../lib/useMedia';

const blank = () => ({ name: '', description: '', createPbi: true, priority: null });
const sprintName = (path) => (path ? path.split('\\').pop() : '');

// Board lanes: three priorities, the unprioritised backlog, and Done
const LANES = [
  { key: 'p1', label: 'P1', hint: 'Top priority', badge: 'bg-red-100 text-red-700', tint: 'bg-red-50/60', bar: 'border-l-red-500' },
  { key: 'p2', label: 'P2', hint: 'Next', badge: 'bg-amber-100 text-amber-700', tint: 'bg-amber-50/60', bar: 'border-l-amber-400' },
  { key: 'p3', label: 'P3', hint: 'When time allows', badge: 'bg-sky-100 text-sky-700', tint: 'bg-sky-50/60', bar: 'border-l-sky-400' },
  { key: 'none', label: 'Unprioritised', hint: 'Not placed yet', badge: 'bg-slate-200 text-slate-700', tint: 'bg-slate-100', bar: 'border-l-slate-300' },
  { key: 'done', label: 'Done', hint: 'Finished projects', badge: 'bg-emerald-100 text-emerald-700', tint: 'bg-emerald-50/70', bar: 'border-l-emerald-500' },
];
const laneOf = (p) => (p.status === 'done' ? 'done' : p.priority || 'none');

export default function Projects() {
  const [projects, setProjects] = useState(null);
  const [form, setForm] = useState(null);
  const [q, setQ] = useState('');
  const [dragOver, setDragOver] = useState(null);
  const [dragging, setDragging] = useState(null);
  const navigate = useNavigate();
  const toast = useToast();
  const isMobile = useIsMobile();
  const [mobileLane, setMobileLane] = useState(localStorage.getItem('workpa_projlane') || 'p1');
  useEffect(() => {
    localStorage.setItem('workpa_projlane', mobileLane);
  }, [mobileLane]);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('new')) {
      setForm(blank());
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params]);

  const [azdo, setAzdo] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = () => ProjectsApi.list().then(setProjects).catch((e) => toast.error(e.message));
  const loadAzdo = () => Integrations.azdo().then(setAzdo).catch(() => setAzdo({ enabled: false }));
  useEffect(() => {
    load();
    loadAzdo();
  }, []);
  // Sync runs in the background right after a save; refresh once so badges pick up the ADO id
  useEffect(() => {
    if (!azdo?.enabled) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [projects?.length, azdo?.enabled]);

  const syncAll = async () => {
    setSyncing(true);
    try {
      const r = await Integrations.azdoSyncAll(false);
      toast.success(
        'Azure DevOps sync finished',
        `Pushed: projects ${r.projects.synced} ok / ${r.projects.failed} failed · tasks ${r.tasks.synced} ok / ${r.tasks.failed} failed · Pulled: ${r.pull?.changed || 0} change(s) from TFS`
      );
      load();
      loadAzdo();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  };
  const retryProject = async (p) => {
    try {
      await Integrations.azdoSyncProject(p._id);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };
  // "Create PBI later" -> now: creates the PBI in the current sprint and pushes the project's waiting tasks
  const createPbi = async (p) => {
    try {
      const r = await Integrations.azdoSyncProject(p._id);
      if (r?.azdo?.id) toast.success(`PBI #${r.azdo.id} created`, r.azdo.iterationPath ? `In ${sprintName(r.azdo.iterationPath)} — the project’s tasks are being pushed too` : '');
      else toast.error('Could not create the PBI', r?.azdo?.error || '');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };
  const isDeferred = (p) => Boolean(p.azdo?.deferred && !p.azdo?.id);

  const save = async () => {
    try {
      if (form._id) {
        const r = await ProjectsApi.update(form._id, { name: form.name, description: form.description, priority: form.priority || null, ...(form.deferred && form.createPbi ? { createPbi: true } : {}) });
        toast.success('Project updated', form.deferred && form.createPbi ? (r?.azdo?.id ? `PBI #${r.azdo.id} created in ${sprintName(r.azdo.iterationPath)}` : r?.azdo?.error || '') : '');
      } else {
        await ProjectsApi.create({ name: form.name, description: form.description, priority: form.priority || null, createPbi: azdo?.enabled ? form.createPbi !== false : undefined });
        toast.success(
          'Project created',
          azdo?.enabled ? (form.createPbi !== false ? `${form.name} · PBI is being created in the current sprint` : `${form.name} · no PBI yet (create it later from the ⋯ menu)`) : form.name
        );
      }
      setForm(null);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  /** Move a project to a lane (priority column or Done). Optimistic, then saved. */
  const moveTo = async (p, lane) => {
    if (laneOf(p) === lane) return;
    const patch = lane === 'done' ? { status: 'done' } : { status: 'active', priority: lane === 'none' ? null : lane };
    setProjects((list) => list.map((x) => (x._id === p._id ? { ...x, ...patch, priority: patch.priority === undefined ? x.priority : patch.priority } : x)));
    try {
      await ProjectsApi.update(p._id, patch);
      const l = LANES.find((x) => x.key === lane);
      toast.success(lane === 'done' ? `${p.name} marked done` : `${p.name} → ${l.label}`);
    } catch (e) {
      toast.error(e.message);
      load();
    }
  };

  const remove = async (p) => {
    const hasTasks = p.counts.total > 0;
    const msg = hasTasks
      ? `Delete "${p.name}"?\n\nIt has ${p.counts.total} task(s). Press OK to delete the project and KEEP the tasks (they become "no project"). To delete the tasks too, cancel and use "Delete with tasks".`
      : `Delete "${p.name}"?`;
    if (!window.confirm(msg)) return;
    await ProjectsApi.remove(p._id, false);
    toast.success('Project deleted');
    load();
  };
  const removeWithTasks = async (p) => {
    if (!window.confirm(`Delete "${p.name}" AND its ${p.counts.total} task(s)? This cannot be undone.`)) return;
    await ProjectsApi.remove(p._id, true);
    toast.success('Project and tasks deleted');
    load();
  };

  // ---- drag & drop (desktop) ----
  const onDragStart = (e, p) => {
    e.dataTransfer.setData('text/plain', p._id);
    e.dataTransfer.effectAllowed = 'move';
    setDragging(p._id);
  };
  const onDrop = (e, lane) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const p = (projects || []).find((x) => x._id === id);
    setDragOver(null);
    setDragging(null);
    if (p) moveTo(p, lane);
  };

  const visible = (projects || []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.description || '').toLowerCase().includes(q.toLowerCase()));
  const byLane = Object.fromEntries(LANES.map((l) => [l.key, visible.filter((p) => laneOf(p) === l.key)]));
  const columns = LANES.slice(0, 4);
  const doneLane = LANES[4];

  const laneHead = (l) => (
    <div className="flex items-center justify-between px-1 pb-3 pt-1">
      <span className="flex items-center gap-2">
        <span className={`badge ${l.badge}`}>{l.label}</span>
        <span className="rounded-full bg-white px-2 text-xs font-semibold leading-5 text-slate-500 shadow-sm">{byLane[l.key].length}</span>
        <span className="text-xs text-slate-400 max-lg:hidden">{l.hint}</span>
      </span>
      {l.key !== 'done' && (
        <button className="btn btn-xs btn-ghost" onClick={() => setForm({ ...blank(), priority: l.key === 'none' ? null : l.key })} title="New project here">
          +
        </button>
      )}
    </div>
  );

  const laneProps = (l) => ({
    'data-lane': l.key,
    onDragOver: (e) => {
      e.preventDefault();
      if (dragOver !== l.key) setDragOver(l.key);
    },
    onDragLeave: () => setDragOver(null),
    onDrop: (e) => onDrop(e, l.key),
  });

  const card = (p, l) => {
    const open = p.counts.total - p.counts.done;
    const pct = p.counts.total ? Math.round((p.counts.done / p.counts.total) * 100) : 0;
    const done = p.status === 'done';
    return (
      <div
        key={p._id}
        className={`group rounded-xl border border-slate-200/70 border-l-4 bg-white px-3.5 py-3 shadow-card transition hover:-translate-y-px hover:shadow-lift ${l.bar} ${dragging === p._id ? 'opacity-50' : ''} ${done ? 'opacity-80' : ''} ${isMobile ? '' : 'cursor-grab'}`}
        draggable={!isMobile}
        onDragStart={(e) => onDragStart(e, p)}
        onDragEnd={() => setDragging(null)}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className={`cursor-pointer truncate text-sm font-semibold text-slate-900 hover:text-primary-600 ${done ? 'line-through decoration-slate-300' : ''}`} onClick={() => navigate(`/tasks?project=${p._id}`)}>
              {p.name}
            </div>
            {p.description && <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{p.description}</div>}
          </div>
          <Menu
            className="-mr-1 -mt-1"
            items={[
              { label: 'Open board', onClick: () => navigate(`/tasks?project=${p._id}`) },
              { label: 'Add task', onClick: () => navigate(`/tasks?project=${p._id}&new=1`) },
              { label: 'Edit project', onClick: () => setForm({ _id: p._id, name: p.name, description: p.description, priority: p.priority || null, deferred: isDeferred(p), createPbi: false }) },
              ...LANES.filter((x) => x.key !== l.key).map((x) => ({ label: x.key === 'done' ? 'Mark as done' : x.key === 'none' ? 'Remove priority' : `Move to ${x.label}`, onClick: () => moveTo(p, x.key) })),
              ...(azdo?.enabled && isDeferred(p) ? [{ label: 'Create PBI in current sprint', onClick: () => createPbi(p) }] : []),
              { label: 'Delete project', danger: true, onClick: () => remove(p) },
              ...(p.counts.total > 0 ? [{ label: 'Delete with all tasks', danger: true, onClick: () => removeWithTasks(p) }] : []),
            ]}
          />
        </div>
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>
              {p.counts.total ? `${open} open · ${p.counts.done}/${p.counts.total} done` : 'No tasks yet'}
            </span>
            {p.counts.total > 0 && <span>{pct}%</span>}
          </div>
          <div className="progress !h-1.5">
            <div className={pct === 100 ? 'bg-emerald-500' : '!bg-brand'} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          {p.counts.inprogress > 0 && <span className="badge badge-inprogress">{p.counts.inprogress} active</span>}
          {p.counts.hold > 0 && <span className="badge badge-hold">{p.counts.hold} hold</span>}
          {isDeferred(p) ? (
            <span className="badge badge-outline cursor-pointer" title="No Product Backlog Item yet — click to create it in the current sprint" onClick={() => createPbi(p)}>
              No PBI
            </span>
          ) : (
            <AzdoBadge azdo={p.azdo} kind="PBI" onRetry={() => retryProject(p)} />
          )}
          {p.azdo?.id && p.azdo.iterationPath && (
            <span className="text-slate-400" title={p.azdo.iterationPath}>
              {sprintName(p.azdo.iterationPath)}
              {p.azdo.state ? ` · ${p.azdo.state}` : ''}
            </span>
          )}
          {p.azdoHistory?.length > 0 && (
            <span className="text-slate-400" title={p.azdoHistory.map((h) => `#${h.id} · ${sprintName(h.iterationPath)} · ${h.state || 'closed'}`).join('\n')}>
              +{p.azdoHistory.length} earlier
            </span>
          )}
          {done && p.doneAt && <span className="ml-auto text-slate-400">done {dayjs(p.doneAt).format('DD MMM')}</span>}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <div className="sub">Priorities P1–P3 as columns — drag a project between them, or into Done when it ships.</div>
        </div>
        <div className="page-actions">
          <input className="input input-sm w-220" type="search" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setForm(blank())}>
            + New project
          </button>
        </div>
      </div>

      {azdo && (
        <div className="card azdo-card mb">
          <span className="dot" style={{ background: !azdo.enabled ? '#94a3b8' : azdo.connection?.ok ? 'var(--success)' : 'var(--danger)' }} />
          <b>Azure DevOps</b>
          {!azdo.enabled ? (
            <span className="muted small">Not configured — set AZDO_ORG_URL, AZDO_PROJECT and AZDO_PAT on the server to mirror projects as PBIs and tasks as child Tasks.</span>
          ) : azdo.connection?.ok ? (
            <>
              <span className="small">
                Connected to <b>{azdo.connection.projectName}</b> (API {azdo.connection.apiVersion}) · projects → {azdo.pbiType}, tasks → {azdo.taskType}
                {azdo.connection.currentSprint && (
                  <>
                    {' '}
                    · current sprint <b>{sprintName(azdo.connection.currentSprint)}</b>
                    {azdo.connection.currentSprintEnds && <> (ends {dayjs(azdo.connection.currentSprintEnds).format('DD MMM')})</>}
                  </>
                )}
                {azdo.connection.pbiDoneState && (
                  <>
                    {' '}
                    · one PBI per sprint, moved to <b>{azdo.connection.pbiDoneState}</b> at sprint end
                  </>
                )}
                {azdo.connection.assignedTo && (
                  <>
                    {' '}
                    · assigned to <b>{azdo.connection.assignedTo.split(' <')[0]}</b>
                  </>
                )}
              </span>
              {(azdo.pending.projects > 0 || azdo.pending.tasks > 0) && (
                <span className="badge badge-soon">
                  {azdo.pending.projects} projects · {azdo.pending.tasks} tasks pending
                </span>
              )}
              {azdo.connection.warnings?.map((w) => (
                <span key={w} className="warn">⚠ {w}</span>
              ))}
              <div className="grow" />
              <button className="btn btn-sm" onClick={syncAll} disabled={syncing} title="Push pending changes to TFS and pull state/assignee/sprint changes back">
                {syncing ? 'Syncing…' : 'Sync now (push + pull)'}
              </button>
            </>
          ) : (
            <span className="small" style={{ color: 'var(--danger)' }}>Connection failed: {azdo.connection?.error}</span>
          )}
        </div>
      )}

      {projects && projects.length === 0 && (
        <div className="card">
          <Empty icon="📁" text="No projects yet. Create one to start grouping tasks." />
        </div>
      )}
      {projects && projects.length > 0 && visible.length === 0 && (
        <div className="card">
          <Empty icon="🔍" text="No projects match." />
        </div>
      )}

      {projects && projects.length > 0 && (
        <>
          {isMobile && (
            <div className="chips status-chips">
              {LANES.map((l) => (
                <button key={l.key} type="button" className={`chip ${mobileLane === l.key ? 'active' : ''}`} onClick={() => setMobileLane(l.key)}>
                  {l.label} <span className="n">{byLane[l.key].length}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(isMobile ? LANES.filter((l) => l.key === mobileLane) : columns).map((l) => (
              <div key={l.key} {...laneProps(l)} className={`min-h-[140px] rounded-xl border p-3 transition md:min-h-[280px] ${dragOver === l.key ? 'border-primary-300 bg-primary-100' : `border-slate-200/70 ${l.tint}`}`}>
                {laneHead(l)}
                <div className="flex flex-col gap-2.5">
                  {byLane[l.key].map((p) => card(p, l))}
                  {byLane[l.key].length === 0 && <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">{isMobile ? `Nothing in ${l.label}` : 'Drop a project here'}</div>}
                </div>
              </div>
            ))}
          </div>
          {!isMobile && (
            <div {...laneProps(doneLane)} className={`mt-4 rounded-xl border p-3 transition ${dragOver === 'done' ? 'border-primary-300 bg-primary-100' : `border-slate-200/70 ${doneLane.tint}`}`}>
              {laneHead(doneLane)}
              {byLane.done.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">Drop a finished project here</div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">{byLane.done.map((p) => card(p, doneLane))}</div>
              )}
            </div>
          )}
        </>
      )}

      {form && (
        <Modal
          title={form._id ? 'Edit project' : 'New project'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()}>
                {form._id ? 'Save changes' : 'Create project'}
              </button>
            </>
          }
        >
          <label className="field">
            Name
            <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && form.name.trim() && save()} placeholder="e.g. Billing Revamp" />
          </label>
          <label className="field">
            Description
            <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Goal, scope, stakeholders…" />
          </label>
          <div className="field">
            Priority
            <div className="segmented">
              {[
                ['p1', 'P1'],
                ['p2', 'P2'],
                ['p3', 'P3'],
                [null, 'None'],
              ].map(([v, label]) => (
                <button key={label} type="button" className={(form.priority || null) === v ? 'active' : ''} onClick={() => setForm({ ...form, priority: v })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {azdo?.enabled && (!form._id || form.deferred) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="checkbox text-sm">
                <input type="checkbox" checked={form.createPbi !== false} onChange={(e) => setForm({ ...form, createPbi: e.target.checked })} />
                <span>
                  {form._id ? 'Create the PBI in the current sprint now' : 'Create a Product Backlog Item in the current sprint'}
                  {azdo.connection?.currentSprint && <span className="text-slate-500"> ({sprintName(azdo.connection.currentSprint)})</span>}
                </span>
              </label>
              <div className="mt-1 pl-7 text-xs text-slate-500">
                {form.createPbi !== false
                  ? 'Tasks added to this project become child Tasks of the PBI. When the sprint ends the PBI is moved to Done, and the next task gets a fresh PBI in the sprint running then.'
                  : 'Nothing is created in Azure DevOps. Create it later from the project’s ⋯ menu; tasks of this project are held back from TFS until then.'}
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
