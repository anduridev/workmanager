import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dashboard as DashApi, Daily, Tasks as TasksApi } from '../lib/api';
import { dayjs, fmtDate, calendarDate, dueLabel, isPast, today } from '../lib/date';
import { StatusBadge, PriorityBadge, Empty, Avatar, TARGET_STATUS_LABEL } from '../components/ui';
import { useToast } from '../components/Toast';
import { CheckSquareIcon, ClockIcon, FlagIcon, SunIcon, PenIcon, TargetIcon } from '../components/icons';

function greeting() {
  const h = dayjs().hour();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const TONES = {
  indigo: 'bg-primary-50 text-primary-600',
  slate: 'bg-slate-100 text-slate-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  green: 'bg-emerald-50 text-emerald-600',
};

function Stat({ label, value, tone = 'slate', onClick, hot }) {
  return (
    <button
      onClick={onClick}
      className="card flex items-center gap-3 p-4 text-left transition hover:border-slate-300 hover:shadow-md max-md:gap-2.5 max-md:p-3"
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-lg font-bold tabular-nums max-md:h-9 max-md:w-9 max-md:text-base ${TONES[hot ? 'red' : tone]}`}>{value}</span>
      <span className="text-[13px] font-medium leading-tight text-slate-600 max-md:text-xs">{label}</span>
    </button>
  );
}

function Section({ icon, title, right, children }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          <span className="text-slate-400">{icon}</span>
          {title}
        </h2>
        {right}
      </div>
      <div className="card-body tight">{children}</div>
    </div>
  );
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
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-[28px]">{greeting()} 👋</h1>
          <p className="mt-1 text-sm text-slate-500">
            {followDue > 0 || overdue > 0
              ? `You have ${followDue ? `${followDue} follow-up${followDue > 1 ? 's' : ''}` : ''}${followDue && overdue ? ' and ' : ''}${
                  overdue ? `${overdue} overdue task${overdue > 1 ? 's' : ''}` : ''
                } needing attention.`
              : 'Nothing overdue. Nice — keep the momentum going.'}
          </p>
        </div>
        <div className="hidden text-sm text-slate-500 md:block">{dayjs().format('dddd, DD MMMM')}</div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="In progress" value={data.counts.inprogress} tone="indigo" onClick={() => navigate('/tasks?status=inprogress')} />
        <Stat label="To do" value={data.counts.todo} tone="slate" onClick={() => navigate('/tasks?status=todo')} />
        <Stat label="On hold" value={data.counts.hold} tone="amber" onClick={() => navigate('/tasks?status=hold')} />
        <Stat label="Overdue" value={overdue} tone="slate" hot={overdue > 0} onClick={() => navigate('/tasks?status=todo,inprogress,hold&overdue=1')} />
        <Stat label="Follow-ups due" value={followDue} tone="slate" hot={followDue > 0} onClick={() => navigate('/team')} />
        <Stat label="Done this week" value={data.doneThisWeek} tone="green" onClick={() => navigate('/tasks?status=done')} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* Today's list */}
        <Section
          icon={<SunIcon size={16} />}
          title="Today's list"
          right={
            <span className="text-[13px] text-slate-500">
              {doneCount}/{todo.length} done
            </span>
          }
        >
          {data.daily.focus && <div className="px-2 py-1.5 text-[13px] font-medium text-primary-700">🎯 {data.daily.focus}</div>}
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
                  <input type="checkbox" checked={i.done} onChange={() => toggleTodo(i)} className="mt-0.5" />
                  {i.scheduledAt && (
                    <span className={`badge ${!i.done && isPast(i.scheduledAt) ? 'badge-overdue' : 'badge-soon'}`}>{dayjs(i.scheduledAt).format('hh:mm A')}</span>
                  )}
                  <span className="txt">{i.text}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="px-2 py-2">
            <Link className="link text-[13px]" to="/today">
              Open today →
            </Link>
          </div>
        </Section>

        {/* Follow-ups */}
        <Section
          icon={<FlagIcon size={16} />}
          title="Follow-ups due"
          right={
            <Link className="link text-[13px]" to="/team">
              All targets →
            </Link>
          }
        >
          {data.followUpsDue.length === 0 && data.reminders.length === 0 && <Empty icon="👍" text="No follow-ups or reminders due today." />}
          <ul className="list">
            {data.followUpsDue.map((t) => (
              <li key={t._id} className="lrow clickable" onClick={() => navigate(`/team/${t._id}`)}>
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
              <li key={r._id} className="lrow clickable" onClick={() => navigate('/reminders')}>
                <span className="text-slate-400">
                  <ClockIcon size={16} />
                </span>
                <div className="grow">
                  <div className="title">{r.title}</div>
                  <div className="meta">
                    <span className={isPast(r.remindAt) ? 'badge badge-overdue' : 'badge badge-soon'}>{calendarDate(r.remindAt)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* Attention: overdue + due soon */}
        <Section icon={<span className="text-amber-500">⚠</span>} title="Needs attention">
          {data.overdueTasks.length === 0 && data.dueSoonTasks.length === 0 && <Empty icon="🧘" text="No overdue or upcoming task deadlines." />}
          <ul className="list">
            {[...data.overdueTasks, ...data.dueSoonTasks].map((t) => (
              <li key={t._id} className="lrow">
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
        </Section>

        {/* In progress */}
        <Section
          icon={<CheckSquareIcon size={16} />}
          title="In progress"
          right={
            <Link className="link text-[13px]" to="/tasks">
              Board →
            </Link>
          }
        >
          {data.inProgress.length === 0 && <Empty icon="💤" text="Nothing in progress. Pick something up from To Do." />}
          <ul className="list">
            {data.inProgress.map((t) => (
              <li key={t._id} className="lrow clickable" onClick={() => navigate(`/tasks/${t._id}`)}>
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
        </Section>

        {/* Upcoming targets */}
        <Section icon={<TargetIcon size={16} />} title="Team targets this week">
          {data.upcomingTargets.length === 0 && <Empty icon="📅" text="No team targets due in the next 7 days." />}
          <ul className="list">
            {data.upcomingTargets.map((t) => (
              <li key={t._id} className="lrow clickable" onClick={() => navigate(`/team/${t._id}`)}>
                <div className="grow">
                  <div className="title">{t.title}</div>
                  <div className="meta">
                    <span className={`badge ${isPast(dayjs(t.targetDate).endOf('day')) ? 'badge-overdue' : 'badge-outline'}`}>{fmtDate(t.targetDate, 'ddd DD MMM')}</span>
                    <StatusBadge status={t.status} labels={TARGET_STATUS_LABEL} />
                    {t.members?.length > 0 && <span>{t.members.map((m) => m.name).join(', ')}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* Recent notes */}
        <Section
          icon={<PenIcon size={16} />}
          title="Recent notes"
          right={
            <Link className="link text-[13px]" to="/notes">
              All notes →
            </Link>
          }
        >
          {data.recentNotes.length === 0 && <Empty icon="🗒" text="No notes yet." />}
          <ul className="list">
            {data.recentNotes.map((n) => (
              <li key={n._id} className="lrow clickable" onClick={() => navigate('/notes')}>
                <div className="grow">
                  <div className="title truncate">{n.title || n.content.slice(0, 80)}</div>
                  <div className="meta">
                    <span>{fmtDate(n.date, 'DD MMM')}</span>
                    {n.title && <span className="truncate">{n.content.slice(0, 80)}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
