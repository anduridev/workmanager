import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Tasks as TasksApi, Projects as ProjectsApi, Integrations } from '../lib/api';
import { dayjs, fmtDate, fmtDateTime, dueLabel, isPast, toDateInput } from '../lib/date';
import { StatusBadge, PriorityBadge, Tag, Empty, Segmented, AzdoBadge, STATUS_LABEL, PRIORITY_LABEL } from '../components/ui';
import Modal, { Drawer } from '../components/Modal';
import { useToast } from '../components/Toast';

const STATUSES = ['todo', 'inprogress', 'hold', 'done'];
const blank = () => ({ title: '', description: '', status: 'todo', priority: 'medium', project: '', tags: '', dueDate: '' });

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState(localStorage.getItem('workpa_taskview') || 'board');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [params, setParams] = useSearchParams();
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const statusFilter = params.get('status') || '';
  const overdueOnly = params.get('overdue') === '1';
  const project = params.get('project') || ''; // project id | 'none' | ''
  const setProject = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('project', id);
    else next.delete('project');
    setParams(next, { replace: true });
  };
  const projectName = (id) => projects.find((p) => p._id === id)?.name;

  const load = useCallback(async () => {
    const list = await TasksApi.list({
      includeDone: view === 'board' || statusFilter.includes('done') ? 'true' : undefined,
      status: view === 'list' && statusFilter ? statusFilter : undefined,
      q: q || undefined,
      project: project || undefined,
    });
    setTasks(list);
  }, [view, statusFilter, q, project]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    ProjectsApi.list().then(setProjects);
  }, []);
  useEffect(() => {
    localStorage.setItem('workpa_taskview', view);
  }, [view]);
  useEffect(() => {
    if (params.get('new')) {
      const pid = params.get('project');
      setForm({ ...blank(), project: pid && pid !== 'none' ? pid : '' });
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params]);

  const visible = useMemo(() => {
    let list = tasks;
    if (overdueOnly) list = list.filter((t) => t.dueDate && isPast(dayjs(t.dueDate).endOf('day')) && t.status !== 'done');
    return list;
  }, [tasks, overdueOnly]);

  const selected = useMemo(() => tasks.find((t) => t._id === id), [tasks, id]);

  const save = async () => {
    const payload = { ...form, dueDate: form.dueDate || null };
    if (form._id) {
      await TasksApi.update(form._id, payload);
      toast.success('Task updated');
    } else {
      const created = await TasksApi.create(payload);
      toast.success('Task created', created.title);
    }
    setForm(null);
    load();
  };

  const setStatus = async (task, status) => {
    if (task.status === status) return;
    setTasks((l) => l.map((t) => (t._id === task._id ? { ...t, status } : t)));
    try {
      await TasksApi.setStatus(task._id, status);
      load();
    } catch (e) {
      toast.error(e.message);
      load();
    }
  };

  const remove = async (task) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    await TasksApi.remove(task._id);
    navigate('/tasks');
    toast.success('Task deleted');
    load();
  };

  // Drag & drop
  const onDragStart = (e, task) => {
    e.dataTransfer.setData('text/plain', task._id);
    e.currentTarget.classList.add('dragging');
  };
  const onDrop = (e, status) => {
    e.preventDefault();
    const tid = e.dataTransfer.getData('text/plain');
    const task = tasks.find((t) => t._id === tid);
    if (task) setStatus(task, status);
    setDragOver(null);
  };

  const openTask = (t) => navigate(`/tasks/${t._id}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My Tasks</h1>
          <div className="sub">
            {tasks.filter((t) => t.status !== 'done').length} open · {tasks.filter((t) => t.status === 'done').length} done{view === 'board' ? '' : ' (in view)'}
          </div>
        </div>
        <div className="page-actions">
          <input className="input input-sm" placeholder="Search tasks & notes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <select className="select input-sm" value={project} onChange={(e) => setProject(e.target.value)} style={{ width: 180 }}>
            <option value="">All projects</option>
            <option value="none">No project</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: 'Board' },
              { value: 'list', label: 'List' },
            ]}
          />
          <button className="btn btn-primary" onClick={() => setForm(blank())}>
            + New task
          </button>
        </div>
      </div>

      {(statusFilter || overdueOnly || project) && (
        <div className="row mb">
          <span className="muted small">Filtered:</span>
          {project && <span className="badge badge-outline">📁 {project === 'none' ? 'No project' : projectName(project) || '…'}</span>}
          {statusFilter && <span className="badge badge-outline">status = {statusFilter}</span>}
          {overdueOnly && <span className="badge badge-overdue">overdue only</span>}
          <button className="btn btn-xs btn-ghost" onClick={() => navigate('/tasks')}>
            clear ✕
          </button>
        </div>
      )}

      {view === 'board' ? (
        <div className="kanban">
          {STATUSES.map((s) => {
            const col = visible.filter((t) => t.status === s && (!statusFilter || statusFilter.split(',').includes(s)));
            return (
              <div
                key={s}
                className={`kanban-col ${dragOver === s ? 'over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(s);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => onDrop(e, s)}
              >
                <div className="kanban-col-head">
                  <span className="row">
                    <StatusBadge status={s} /> <span className="n">{col.length}</span>
                  </span>
                  <button className="btn btn-xs btn-ghost" onClick={() => setForm({ ...blank(), status: s })} title="Add here">
                    +
                  </button>
                </div>
                <div className="kanban-cards">
                  {col.map((t) => (
                    <div
                      key={t._id}
                      className="tcard"
                      draggable
                      onDragStart={(e) => onDragStart(e, t)}
                      onDragEnd={(e) => e.currentTarget.classList.remove('dragging')}
                      onClick={() => openTask(t)}
                    >
                      <div className="t">{t.title}</div>
                      <div className="foot">
                        <span className={`prio prio-${t.priority}`} title={PRIORITY_LABEL[t.priority]} />
                        {t.project?.name && <span>📁 {t.project.name}</span>}
                        {t.dueDate && (
                          <span className={isPast(dayjs(t.dueDate).endOf('day')) && s !== 'done' ? 'badge badge-overdue' : ''}>{dueLabel(t.dueDate)}</span>
                        )}
                        {t.notes?.length > 0 && <span>✎ {t.notes.length}</span>}
                        <AzdoBadge azdo={t.azdo} />
                        {t.tags?.slice(0, 2).map((tg) => (
                          <span key={tg} className="badge badge-tag">
                            {tg}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {col.length === 0 && <div className="empty xs" style={{ padding: 16 }}>Drop tasks here</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          {visible.length === 0 && <Empty icon="☑" text="No tasks match." />}
          {visible.length > 0 && (
            <table className="task-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Project</th>
                  <th>Due</th>
                  <th>Notes</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t._id} onClick={() => openTask(t)}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{t.title}</div>
                      {t.tags?.length > 0 && (
                        <div className="row wrap" style={{ marginTop: 3 }}>
                          {t.tags.map((tg) => (
                            <Tag key={tg}>{tg}</Tag>
                          ))}
                        </div>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select className="select input-sm" value={t.status} onChange={(e) => setStatus(t, e.target.value)} style={{ width: 130 }}>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="muted">{t.project?.name || '—'}</td>
                    <td>
                      {t.dueDate ? (
                        <span className={isPast(dayjs(t.dueDate).endOf('day')) && t.status !== 'done' ? 'badge badge-overdue' : ''}>{fmtDate(t.dueDate, 'DD MMM')}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">{t.notes?.length || 0}</td>
                    <td className="muted small">{dayjs(t.updatedAt).fromNow()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selected && (
        <TaskDrawer
          task={selected}
          onClose={() => navigate('/tasks')}
          onChange={load}
          onEdit={() =>
            setForm({ ...selected, project: selected.project?._id || '', tags: (selected.tags || []).join(', '), dueDate: toDateInput(selected.dueDate) })
          }
          onDelete={() => remove(selected)}
          setStatus={setStatus}
        />
      )}

      {form && (
        <Modal
          title={form._id ? 'Edit task' : 'New task'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={!form.title.trim()}>
                {form._id ? 'Save changes' : 'Create task'}
              </button>
            </>
          }
        >
          <label className="field">
            Title
            <input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && form.title.trim() && save()} />
          </label>
          <label className="field">
            Description
            <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <div className="form-grid">
            <label className="field">
              Status
              <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Priority
              <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Project (optional)
              <select className="select" value={form.project || ''} onChange={(e) => setForm({ ...form, project: e.target.value })}>
                <option value="">— No project —</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Due date
              <input className="input" type="date" value={form.dueDate || ''} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </label>
            <label className="field full">
              Tags (comma separated)
              <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="client, backend, review" />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}

function TaskDrawer({ task, onClose, onChange, onEdit, onDelete, setStatus }) {
  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState(null);
  const toast = useToast();

  const addNote = async (e) => {
    e?.preventDefault();
    if (!note.trim()) return;
    await TasksApi.addNote(task._id, note.trim());
    setNote('');
    onChange();
  };
  const saveNote = async () => {
    if (editingNote?.text.trim()) await TasksApi.updateNote(task._id, editingNote.id, editingNote.text.trim());
    setEditingNote(null);
    onChange();
  };
  const removeNote = async (n) => {
    if (!window.confirm('Delete this note?')) return;
    await TasksApi.removeNote(task._id, n._id);
    onChange();
  };

  const notes = [...(task.notes || [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <Drawer
      onClose={onClose}
      title={
        <div>
          <div className="row wrap">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.project?.name && <span className="badge badge-outline">📁 {task.project.name}</span>}
            <AzdoBadge
              azdo={task.azdo}
              onRetry={async () => {
                try {
                  await Integrations.azdoSyncTask(task._id);
                  onChange();
                } catch (e) {
                  toast.error(e.message);
                }
              }}
            />
          </div>
          <h2 style={{ marginTop: 6 }}>{task.title}</h2>
        </div>
      }
      actions={
        <>
          <button className="btn btn-sm" onClick={onEdit}>
            Edit
          </button>
          <button className="btn btn-sm btn-danger" onClick={onDelete}>
            Delete
          </button>
        </>
      }
    >
      <div>
        <div className="section-title">Status</div>
        <div className="segmented">
          {STATUSES.map((s) => (
            <button key={s} className={task.status === s ? 'active' : ''} onClick={() => setStatus(task, s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="row wrap muted small">
        {task.dueDate && (
          <span className={isPast(dayjs(task.dueDate).endOf('day')) && task.status !== 'done' ? 'badge badge-overdue' : 'badge badge-outline'}>
            Due {fmtDate(task.dueDate)} · {dueLabel(task.dueDate)}
          </span>
        )}
        {task.azdo?.iterationPath && <span className="badge badge-outline">🏁 {task.azdo.iterationPath.split('\\').pop()}</span>}
        <span>Created {fmtDateTime(task.createdAt)}</span>
        {task.completedAt && <span>· Completed {fmtDateTime(task.completedAt)}</span>}
        {task.tags?.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>

      {task.description && (
        <div>
          <div className="section-title">Description</div>
          <div className="pre">{task.description}</div>
        </div>
      )}

      <div>
        <div className="section-title">Notes ({notes.length})</div>
        <form onSubmit={addNote} className="col" style={{ marginBottom: 12 }}>
          <textarea
            className="textarea"
            style={{ minHeight: 64 }}
            placeholder="Add a progress note… (Ctrl+Enter to save)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && addNote(e)}
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" disabled={!note.trim()}>
              Add note
            </button>
          </div>
        </form>
        {notes.length === 0 && <div className="muted small">No notes yet. Log progress, blockers, decisions.</div>}
        <div className="timeline">
          {notes.map((n) => (
            <div key={n._id} className="tl-item">
              <div className="tl-dot" />
              <div className="tl-body">
                <div className="when">
                  <span>
                    {fmtDateTime(n.createdAt)}
                    {n.updatedAt !== n.createdAt && ' · edited'}
                  </span>
                  <span className="actions">
                    <button className="btn btn-xs btn-ghost" onClick={() => setEditingNote({ id: n._id, text: n.text })}>
                      Edit
                    </button>
                    <button className="btn btn-xs btn-ghost btn-danger" onClick={() => removeNote(n)}>
                      ✕
                    </button>
                  </span>
                </div>
                {editingNote?.id === n._id ? (
                  <div className="col">
                    <textarea className="textarea" style={{ minHeight: 60 }} autoFocus value={editingNote.text} onChange={(e) => setEditingNote({ ...editingNote, text: e.target.value })} />
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-xs" onClick={() => setEditingNote(null)}>
                        Cancel
                      </button>
                      <button className="btn btn-xs btn-primary" onClick={saveNote}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pre">{n.text}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {task.statusHistory?.length > 0 && (
        <div>
          <div className="section-title">Status history</div>
          <div className="history">
            {[...task.statusHistory].reverse().map((h, i) => (
              <span key={i} className="h">
                {h.from ? `${STATUS_LABEL[h.from]} → ` : ''}
                {STATUS_LABEL[h.to]} · {fmtDateTime(h.at)}
              </span>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
