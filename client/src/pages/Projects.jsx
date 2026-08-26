import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Projects as ProjectsApi, Integrations } from '../lib/api';
import { dayjs, fromNow } from '../lib/date';
import { Empty, AzdoBadge } from '../components/ui';
import Modal from '../components/Modal';
import Menu from '../components/Menu';
import { FolderIcon, PlusIcon } from '../components/icons';
import { useToast } from '../components/Toast';

const blank = () => ({ name: '', description: '' });

export default function Projects() {
  const [projects, setProjects] = useState(null);
  const [form, setForm] = useState(null);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
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

  const save = async () => {
    try {
      if (form._id) {
        await ProjectsApi.update(form._id, form);
        toast.success('Project updated');
      } else {
        await ProjectsApi.create(form);
        toast.success('Project created', form.name);
      }
      setForm(null);
      load();
    } catch (e) {
      toast.error(e.message);
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

  const visible = (projects || []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.description.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <div className="sub">Group tasks under a project. Tasks can also live outside any project.</div>
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
                    · current sprint <b>{azdo.connection.currentSprint.split('\\').pop()}</b>
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

      <div className="projects-grid">
        {visible.map((p) => {
          const open = p.counts.total - p.counts.done;
          const pct = p.counts.total ? Math.round((p.counts.done / p.counts.total) * 100) : 0;
          return (
            <div key={p._id} className="project-card">
              <div className="flex items-start gap-3.5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary-600">
                  <FolderIcon size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="cursor-pointer truncate text-[17px] font-bold text-slate-900 hover:text-primary-600" onClick={() => navigate(`/tasks?project=${p._id}`)}>
                    {p.name}
                  </h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
                    <span>
                      {p.counts.total} task{p.counts.total === 1 ? '' : 's'} · {open} open
                    </span>
                    <AzdoBadge azdo={p.azdo} kind="PBI" onRetry={() => retryProject(p)} />
                  </div>
                </div>
                <Menu
                  items={[
                    { label: 'Edit project', onClick: () => setForm({ _id: p._id, name: p.name, description: p.description }) },
                    { label: 'Delete project', danger: true, onClick: () => remove(p) },
                    ...(p.counts.total > 0 ? [{ label: 'Delete with all tasks', danger: true, onClick: () => removeWithTasks(p) }] : []),
                  ]}
                />
              </div>
              <p className={`mt-3 line-clamp-2 min-h-[2.75rem] text-[14px] leading-relaxed ${p.description ? 'text-slate-600' : 'italic text-slate-400'}`}>{p.description || 'No description'}</p>
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>{pct}% complete</span>
                  <span>
                    {p.counts.done}/{p.counts.total} done
                  </span>
                </div>
                <div className="progress">
                  <div className={pct === 100 ? 'bg-emerald-500' : '!bg-brand'} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="mb-5 mt-3 flex min-h-[24px] flex-wrap gap-1.5">
                {p.counts.todo > 0 && <span className="badge badge-todo">{p.counts.todo} to do</span>}
                {p.counts.inprogress > 0 && <span className="badge badge-inprogress">{p.counts.inprogress} in progress</span>}
                {p.counts.hold > 0 && <span className="badge badge-hold">{p.counts.hold} on hold</span>}
                {p.counts.done > 0 && <span className="badge badge-done">{p.counts.done} done</span>}
                {p.counts.total === 0 && <span className="text-xs text-slate-400">No tasks yet</span>}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-4 max-md:justify-end" style={{ marginTop: "auto" }}>
                <span className="text-xs text-slate-400 max-md:hidden">Created {dayjs(p.createdAt).format('DD MMM YYYY')}</span>
                <div className="flex gap-2">
                  <button className="btn btn-sm" onClick={() => navigate(`/tasks?project=${p._id}`)}>
                    Open board
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => navigate(`/tasks?project=${p._id}&new=1`)}>
                    <PlusIcon size={14} /> Task
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

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
        </Modal>
      )}
    </>
  );
}
