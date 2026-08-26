import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dashboard as DashApi, Daily, Tasks as TasksApi } from '../lib/api';
import { dayjs, fmtDate, calendarDate, dueLabel, isPast, today } from '../lib/date';
import { StatusBadge, PriorityBadge, Empty, Avatar, TARGET_STATUS_LABEL } from '../components/ui';
import { useToast } from '../components/Toast';

function greeting() {
  const h = dayjs().hour();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  const load = () => DashApi.get().then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="empty">{error}</div>;
  if (!data) return <div className="empty">Loading…</div>;

  const todo = data.daily.items;
  const doneCount = todo.filter((i) => i.done).length;
  const followDue = data.followUpsDue.length;
  const overdue = data.overdueTasks.length;

  const toggleTodo = async (item) => {
    await Daily.updateItem(today(), item._id, { done: !item.done });
    load();
  };
  const finishTask = async (t) => {
    await TasksApi.setStatus(t._id, 'done');
    toast.success('Task completed', t.title);
    load();
  };

  return (
    <>
      <div className="greeting">
        <h1>{greeting()} 👋</h1>
        <p>
          {followDue > 0 || overdue > 0
            ? `You have ${followDue ? `${followDue} follow-up${followDue > 1 ? 's' : ''}` : ''}${followDue && overdue ? ' and ' : ''}${
                overdue ? `${overdue} overdue task${overdue > 1 ? 's' : ''}` : ''
              } needing attention.`
            : 'Nothing overdue. Nice — keep the momentum going.'}
        </p>
      </div>

      <div className="stats">
        <div className="stat" onClick={() => navigate('/tasks?status=inprogress')}>
          <div className="label">In progress</div>
          <div className="value primary">{data.counts.inprogress}</div>
        </div>
        <div className="stat" onClick={() => navigate('/tasks?status=todo')}>
          <div className="label">To do</div>
          <div className="value">{data.counts.todo}</div>
        </div>
        <div className="stat" onClick={() => navigate('/tasks?status=hold')}>
          <div className="label">On hold</div>
          <div className="value warn">{data.counts.hold}</div>
        </div>
        <div className="stat" onClick={() => navigate('/tasks?status=todo,inprogress,hold&overdue=1')}>
          <div className="label">Overdue</div>
          <div className={`value ${overdue ? 'danger' : ''}`}>{overdue}</div>
        </div>
        <div className="stat" onClick={() => navigate('/team')}>
          <div className="label">Follow-ups due</div>
          <div className={`value ${followDue ? 'danger' : ''}`}>{followDue}</div>
        </div>
        <div className="stat" onClick={() => navigate('/tasks?status=done')}>
          <div className="label">Done this week</div>
          <div className="value success">{data.doneThisWeek}</div>
        </div>
      </div>

      <div className="dash-grid">
        {/* Today's list */}
        <div className="card">
          <div className="card-head">
            <h2>☀ Today's list</h2>
            <span className="muted small">
              {doneCount}/{todo.length} done
            </span>
          </div>
          <div className="card-body tight">
            {data.daily.focus && (
              <div className="small" style={{ padding: '6px 8px', color: 'var(--primary)', fontWeight: 500 }}>
                🎯 {data.daily.focus}
              </div>
            )}
            {todo.length === 0 ? (
              <Empty icon="📝" text="No items for today yet.">
                <Link className="link" to="/today">
                  Plan your day →
                </Link>
              </Empty>
            ) : (
              <ul>
                {todo.map((i) => (
                  <li key={i._id} className={`todo-item ${i.done ? 'done' : ''}`}>
                    <input type="checkbox" checked={i.done} onChange={() => toggleTodo(i)} />
                    {i.scheduledAt && (
                      <span className={`badge ${!i.done && isPast(i.scheduledAt) ? 'badge-overdue' : 'badge-soon'}`}>{dayjs(i.scheduledAt).format('hh:mm A')}</span>
                    )}
                    <span className="txt">{i.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ padding: '8px' }}>
              <Link className="link small" to="/today">
                Open today →
              </Link>
            </div>
          </div>
        </div>

        {/* Follow-ups */}
        <div className="card">
          <div className="card-head">
            <h2>⚑ Follow-ups due</h2>
            <Link className="link small" to="/team">
              All targets →
            </Link>
          </div>
          <div className="card-body tight">
            {data.followUpsDue.length === 0 && data.reminders.length === 0 && <Empty icon="👍" text="No follow-ups or reminders due today." />}
            <ul className="list">
              {data.followUpsDue.map((t) => (
                <li key={t._id} className="list-item clickable" onClick={() => navigate(`/team/${t._id}`)}>
                  <div className="grow">
                    <div className="title">{t.title}</div>
                    <div className="meta">
                      <span className={isPast(t.followUpAt) ? 'badge badge-overdue' : 'badge badge-soon'}>{calendarDate(t.followUpAt)}</span>
                      {t.members?.length > 0 && <span>{t.members.map((m) => m.name).join(', ')}</span>}
                    </div>
                  </div>
                  <div className="avatars">
                    {t.members?.slice(0, 3).map((m) => (
                      <Avatar key={m._id} name={m.name} />
                    ))}
                  </div>
                </li>
              ))}
              {data.reminders.map((r) => (
                <li key={r._id} className="list-item clickable" onClick={() => navigate('/reminders')}>
                  <span>⏰</span>
                  <div className="grow">
                    <div className="title">{r.title}</div>
                    <div className="meta">
                      <span className={isPast(r.remindAt) ? 'badge badge-overdue' : 'badge badge-soon'}>{calendarDate(r.remindAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Attention: overdue + due soon */}
        <div className="card">
          <div className="card-head">
            <h2>⚠ Needs attention</h2>
          </div>
          <div className="card-body tight">
            {data.overdueTasks.length === 0 && data.dueSoonTasks.length === 0 && <Empty icon="🧘" text="No overdue or upcoming task deadlines." />}
            <ul className="list">
              {[...data.overdueTasks, ...data.dueSoonTasks].map((t) => (
                <li key={t._id} className="list-item">
                  <div className="grow clickable" onClick={() => navigate(`/tasks/${t._id}`)}>
                    <div className="title">{t.title}</div>
                    <div className="meta">
                      <span className={`badge ${isPast(dayjs(t.dueDate).endOf('day')) ? 'badge-overdue' : 'badge-soon'}`}>{dueLabel(t.dueDate)}</span>
                      <StatusBadge status={t.status} />
                      <PriorityBadge priority={t.priority} />
                    </div>
                  </div>
                  <button className="btn btn-xs" onClick={() => finishTask(t)} title="Mark done">
                    ✓
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* In progress */}
        <div className="card">
          <div className="card-head">
            <h2>▶ In progress</h2>
            <Link className="link small" to="/tasks">
              Board →
            </Link>
          </div>
          <div className="card-body tight">
            {data.inProgress.length === 0 && <Empty icon="💤" text="Nothing in progress. Pick something up from To Do." />}
            <ul className="list">
              {data.inProgress.map((t) => (
                <li key={t._id} className="list-item clickable" onClick={() => navigate(`/tasks/${t._id}`)}>
                  <div className="grow">
                    <div className="title">{t.title}</div>
                    <div className="meta">
                      {t.project?.name && <span>📁 {t.project.name}</span>}
                      <PriorityBadge priority={t.priority} />
                      {t.dueDate && <span>{dueLabel(t.dueDate)}</span>}
                      {t.notes?.length > 0 && <span>{t.notes.length} notes</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Upcoming targets */}
        <div className="card">
          <div className="card-head">
            <h2>🎯 Team targets this week</h2>
          </div>
          <div className="card-body tight">
            {data.upcomingTargets.length === 0 && <Empty icon="📅" text="No team targets due in the next 7 days." />}
            <ul className="list">
              {data.upcomingTargets.map((t) => (
                <li key={t._id} className="list-item clickable" onClick={() => navigate(`/team/${t._id}`)}>
                  <div className="grow">
                    <div className="title">{t.title}</div>
                    <div className="meta">
                      <span className={`badge ${isPast(dayjs(t.targetDate).endOf('day')) ? 'badge-overdue' : 'badge-outline'}`}>
                        {fmtDate(t.targetDate, 'ddd DD MMM')}
                      </span>
                      <StatusBadge status={t.status} labels={TARGET_STATUS_LABEL} />
                      {t.members?.length > 0 && <span>{t.members.map((m) => m.name).join(', ')}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Recent notes */}
        <div className="card">
          <div className="card-head">
            <h2>✎ Recent notes</h2>
            <Link className="link small" to="/notes">
              All notes →
            </Link>
          </div>
          <div className="card-body tight">
            {data.recentNotes.length === 0 && <Empty icon="🗒" text="No notes yet." />}
            <ul className="list">
              {data.recentNotes.map((n) => (
                <li key={n._id} className="list-item clickable" onClick={() => navigate('/notes')}>
                  <div className="grow">
                    <div className="title ellipsis">{n.title || n.content.slice(0, 80)}</div>
                    <div className="meta">
                      <span>{fmtDate(n.date, 'DD MMM')}</span>
                      {n.title && <span className="ellipsis">{n.content.slice(0, 80)}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
