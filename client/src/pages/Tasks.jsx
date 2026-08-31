import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Tasks as TasksApi, Projects as ProjectsApi, Integrations } from '../lib/api';
import { dayjs, fmtDate, fmtDateTime, dueLabel, isPast, toDateInput } from '../lib/date';
import { StatusBadge, PriorityBadge, Tag, Empty, Segmented, AzdoBadge, STATUS_LABEL, PRIORITY_LABEL } from '../components/ui';
import Modal, { Drawer } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useIsMobile } from '../lib/useMedia';

const STATUSES = ['todo', 'inprogress', 'hold', 'done'];
const PRIO_BAR = { low: 'border-l-slate-300', medium: 'border-l-cyan-400', high: 'border-l-amber-400', urgent: 'border-l-red-500' };
const COL_TINT = { todo: 'bg-slate-100', inprogress: 'bg-primary-50', hold: 'bg-amber-50', done: 'bg-emerald-50' };
const blank = () => ({ title: '', description: '', status: 'todo', priority: 'medium', project: '', extPbi: null, tags: '', dueDate: '' });

/** "⧉ title" chip text when the task is attached to an existing sprint PBI (instead of a work item). */
const extPbiLabel = (t) => (!t.project?.name && t.azdo?.extParentId ? `⧉ ${t.azdo.extParentTitle || `PBI #${t.azdo.extParentId}`}` : null);

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
  const isMobile = useIsMobile();
  const [mobileCol, setMobileCol] = useState(localStorage.getItem('workpa_mobilecol') || 'todo');
  useEffect(() => {
    localStorage.setItem('workpa_mobilecol', mobileCol);
  }, [mobileCol]);

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
  const [sprintPbis, setSprintPbis] = useState([]);
  useEffect(() => {
    ProjectsApi.list().then(setProjects);
    // Open PBIs in the current sprint (empty when Azure DevOps is not configured)
    Integrations.azdoSprintPbis()
      .then((r) => setSprintPbis(r?.pbis || []))
      .catch(() => setSprintPbis([]));
  }, []);
  useEffect(() => {
    localStorage.setItem('workpa_taskview', view);
  }, [view]);
  useEffect(() => {
    if (params.get('new')) {
      const pid = params.get('project');
      setForm({ ...blank(), project: pid && pid !== 'none' ? pid : '', title: params.get('title') || '' });
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
          <input className="input input-sm w-220" type="search" placeholder="Search tasks & notes…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select input-sm w-180" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All work items</option>
            <option value="none">No work item</option>
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
          {project && <span className="badge badge-outline">📁 {project === 'none' ? 'No work item' : projectName(project) || '…'}</span>}
          {statusFilter && <span className="badge badge-outline">status = {statusFilter}</span>}
          {overdueOnly && <span className="badge badge-overdue">overdue only</span>}
          <button className="btn btn-xs btn-ghost" onClick={() => navigate('/tasks')}>
            clear ✕
          </button>
        </div>
      )}

      {view === 'board' && isMobile && (
        <div className="chips status-chips">
          {STATUSES.map((s) => {
            const n = visible.filter((t) => t.status === s).length;
            return (
              <button key={s} type="button" className={`chip ${mobileCol === s ? 'active' : ''}`} onClick={() => setMobileCol(s)}>
                {STATUS_LABEL[s]} <span className="n">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {view === 'board' ? (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-4 max-md:gap-3">
          {STATUSES.filter((s) => !isMobile || s === mobileCol).map((s) => {
            const col = visible.filter((t) => t.status === s && (!statusFilter || statusFilter.split(',').includes(s)));
            return (
              <div
                key={s}
                data-status={s}
                className={`min-h-[140px] rounded-xl border p-3 transition md:min-h-[240px] ${dragOver === s ? 'border-primary-300 bg-primary-100' : `border-slate-200/70 ${COL_TINT[s]}`}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(s);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => onDrop(e, s)}
              >
                <div className="flex items-center justify-between px-1 pb-3 pt-1 text-[13px] font-semibold">
                  <span className="row">
                    <StatusBadge status={s} /> <span className="rounded-full bg-white px-2 text-xs font-semibold leading-5 text-slate-500 shadow-sm">{col.length}</span>
                  </span>
                  <button className="btn btn-xs btn-ghost" onClick={() => setForm({ ...blank(), status: s })} title="Add here">
                    +
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {col.map((t) => (
                    <div
                      key={t._id}
                      className={`tcard ${PRIO_BAR[t.priority] || PRIO_BAR.medium}`}
                      draggable={!isMobile}
                      onDragStart={(e) => onDragStart(e, t)}
                      onDragEnd={(e) => e.currentTarget.classList.remove('dragging')}
                      onClick={() => openTask(t)}
                    >
                      <div className="t">{t.title}</div>
                      <div className="foot">
                        <span className={`prio prio-${t.priority}`} title={PRIORITY_LABEL[t.priority]} />
                        {t.project?.name && <span>📁 {t.project.name}</span>}
                        {extPbiLabel(t) && <span className="truncate" style={{ maxWidth: 140 }}>{extPbiLabel(t)}</span>}
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
                  {col.length === 0 && (
                    <div className="empty xs" style={{ padding: 16 }}>
                      {isMobile ? `Nothing ${STATUS_LABEL[s].toLowerCase()}` : 'Drop tasks here'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          {visible.length === 0 && <Empty icon="☑" text="No tasks match." />}
          {visible.length > 0 && isMobile && (
            <ul className="list mlist">
              {visible.map((t) => (
                <li key={t._id} className="lrow">
                  <div className="grow clickable" onClick={() => openTask(t)}>
                    <div className="title">{t.title}</div>
                    <div className="meta">
                      <PriorityBadge priority={t.priority} />
                      {t.project?.name && <span>📁 {t.project.name}</span>}
                      {extPbiLabel(t) && <span>{extPbiLabel(t)}</span>}
                      {t.dueDate && (
                        <span className={isPast(dayjs(t.dueDate).endOf('day')) && t.status !== 'done' ? 'badge badge-overdue' : ''}>{dueLabel(t.dueDate)}</span>
                      )}
                      {t.notes?.length > 0 && <span>✎ {t.notes.length}</span>}
                      <AzdoBadge azdo={t.azdo} />
                    </div>
                  </div>
                  <select className="select" value={t.status} onChange={(e) => setStatus(t, e.target.value)} aria-label="Status">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
          {visible.length > 0 && !isMobile && (
            <table className="task-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Work Item</th>
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
                      <select className="select input-sm w-130" value={t.status} onChange={(e) => setStatus(t, e.target.value)}>
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
                    <td className="muted">{t.project?.name || extPbiLabel(t) || '—'}</td>
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
            setForm({
              ...selected,
              project: selected.project?._id || '',
              extPbi: selected.azdo?.extParentId ? { id: selected.azdo.extParentId, title: selected.azdo.extParentTitle || '' } : null,
              tags: (selected.tags || []).join(', '),
              dueDate: toDateInput(selected.dueDate),
            })
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
              Work Item (optional)
              <select
                className="select"
                value={form.extPbi ? `pbi:${form.extPbi.id}` : form.project || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith('pbi:')) {
                    const id = Number(v.slice(4));
                    const b = sprintPbis.find((x) => x.id === id);
                    setForm({ ...form, project: '', extPbi: { id, title: b?.title || form.extPbi?.title || '' } });
                  } else setForm({ ...form, project: v, extPbi: null });
                }}
              >
                <option value="">— No work item —</option>
                {projects.length > 0 && (
                  <optgroup label="Work Items">
                    {projects.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(sprintPbis.length > 0 || form.extPbi) && (
                  <optgroup label="Current sprint PBIs (Azure DevOps)">
                    {form.extPbi && !sprintPbis.some((b) => b.id === form.extPbi.id) && (
                      <option value={`pbi:${form.extPbi.id}`}>
                        #{form.extPbi.id} · {form.extPbi.title || 'PBI'}
                      </option>
                    )}
                    {sprintPbis.map((b) => (
                      <option key={b.id} value={`pbi:${b.id}`}>
                        #{b.id} · {b.title}
                      </option>
                    ))}
                  </optgroup>
                )}
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
            {extPbiLabel(task) && <span className="badge badge-outline">{extPbiLabel(task)}</span>}
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
        {task.azdo?.assignedTo && <span className="badge badge-outline">👤 {task.azdo.assignedTo}</span>}
        {task.azdo?.state && <span className="badge badge-outline">TFS: {task.azdo.state}</span>}
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
                {h.source === 'tfs' && ' · from TFS'}
              </span>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
