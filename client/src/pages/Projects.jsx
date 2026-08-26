import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Projects as ProjectsApi, Integrations } from '../lib/api';
import { dayjs, fromNow } from '../lib/date';
import { Empty, AzdoBadge } from '../components/ui';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';

const blank = () => ({ name: '', description: '' });

export default function Projects() {
  const [projects, setProjects] = useState(null);
  const [form, setForm] = useState(null);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

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
          <input className="input input-sm" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
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
              <div className="ph">
                <h3 className="clickable" onClick={() => navigate(`/tasks?project=${p._id}`)}>
                  📁 {p.name}
                </h3>
                <span className="row" style={{ whiteSpace: 'nowrap' }}>
                  <AzdoBadge azdo={p.azdo} kind="PBI" onRetry={() => retryProject(p)} />
                  <span className="xs muted">{p.counts.total} tasks</span>
                </span>
              </div>
              {p.description ? <p className="desc pre">{p.description}</p> : <p className="desc muted">No description</p>}
              <div className="row between mt">
                <div className="row wrap xs">
                  <span className="badge badge-todo">{p.counts.todo} to do</span>
                  <span className="badge badge-inprogress">{p.counts.inprogress} in progress</span>
                  <span className="badge badge-hold">{p.counts.hold} on hold</span>
                  <span className="badge badge-done">{p.counts.done} done</span>
                </div>
              </div>
              <div className="row mt" style={{ gap: 10 }}>
                <div className="progress grow">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <span className="xs muted" style={{ whiteSpace: 'nowrap' }}>
                  {pct}% · {open} open
                </span>
              </div>
              <div className="row between mt wrap">
                <div className="row acts">
                  <button className="btn btn-xs btn-ghost" onClick={() => setForm({ _id: p._id, name: p.name, description: p.description })}>
                    Edit
                  </button>
                  <button className="btn btn-xs btn-ghost btn-danger" onClick={() => remove(p)}>
                    Delete
                  </button>
                  {p.counts.total > 0 && (
                    <button className="btn btn-xs btn-ghost btn-danger" title="Delete project and all its tasks" onClick={() => removeWithTasks(p)}>
                      Delete with tasks
                    </button>
                  )}
                </div>
                <div className="row">
                  <button className="btn btn-xs" onClick={() => navigate(`/tasks?project=${p._id}`)}>
                    View tasks
                  </button>
                  <button className="btn btn-xs btn-primary" onClick={() => navigate(`/tasks?project=${p._id}&new=1`)}>
                    + Task
                  </button>
                </div>
              </div>
              <div className="xs muted mt" style={{ marginTop: 8 }}>Created {dayjs(p.createdAt).format('DD MMM YYYY')}</div>
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
