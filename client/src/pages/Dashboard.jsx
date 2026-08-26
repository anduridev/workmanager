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
  indigo: { num: 'text-primary-600', tile: 'bg-primary-50 text-primary-600' },
  slate: { num: 'text-slate-900', tile: 'bg-slate-100 text-slate-500' },
  amber: { num: 'text-amber-600', tile: 'bg-amber-50 text-amber-600' },
  red: { num: 'text-red-600', tile: 'bg-red-50 text-red-600' },
  green: { num: 'text-emerald-600', tile: 'bg-emerald-50 text-emerald-600' },
};

function Stat({ label, value, tone = 'slate', onClick, hot, icon }) {
  const t = TONES[hot ? 'red' : tone];
  return (
    <button onClick={onClick} className="card flex items-start justify-between gap-2 p-5 text-left transition hover:-translate-y-px hover:shadow-lift max-md:p-4">
      <span>
        <span className={`block text-2xl font-bold tabular-nums leading-none tracking-tight ${t.num}`}>{value}</span>
        <span className="mt-1.5 block text-xs font-medium text-slate-500">{label}</span>
      </span>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${t.tile}`}>{icon}</span>
    </button>
  );
}

function Section({ icon, title, right, children, tone = 'bg-primary-50 text-primary-600' }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          <span className={`grid h-8 w-8 place-items-center rounded-lg ${tone}`}>{icon}</span>
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
      <div className="relative mb-5 overflow-hidden rounded-2xl bg-brand p-6 text-white shadow-glow max-md:p-5">
        <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-28 right-32 h-64 w-64 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{dayjs().format('dddd, DD MMMM')}</div>
            <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight">{greeting()} 👋</h1>
            <p className="mt-1.5 max-w-xl text-sm text-white/85">
              {followDue > 0 || overdue > 0
                ? `You have ${followDue ? `${followDue} follow-up${followDue > 1 ? 's' : ''}` : ''}${followDue && overdue ? ' and ' : ''}${
                    overdue ? `${overdue} overdue task${overdue > 1 ? 's' : ''}` : ''
                  } needing attention.`
                : 'Nothing overdue. Nice — keep the momentum going.'}
            </p>
          </div>
          {data.daily.focus ? (
            <div className="rounded-2xl bg-white/15 px-4 py-3 backdrop-blur max-md:w-full">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">Today's focus</div>
              <div className="mt-0.5 text-sm font-semibold">🎯 {data.daily.focus}</div>
            </div>
          ) : (
            <Link to="/today" className="rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold backdrop-blur transition hover:bg-white/25">
              Set today's focus →
            </Link>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="In progress" value={data.counts.inprogress} tone="indigo" icon={<CheckSquareIcon size={18} />} onClick={() => navigate('/tasks?status=inprogress')} />
        <Stat label="To do" value={data.counts.todo} tone="slate" icon={<CheckSquareIcon size={18} />} onClick={() => navigate('/tasks?status=todo')} />
        <Stat label="On hold" value={data.counts.hold} tone="amber" icon={<ClockIcon size={18} />} onClick={() => navigate('/tasks?status=hold')} />
        <Stat label="Overdue" value={overdue} tone="slate" hot={overdue > 0} icon={<span className="text-base">⚠</span>} onClick={() => navigate('/tasks?status=todo,inprogress,hold&overdue=1')} />
        <Stat label="Follow-ups due" value={followDue} tone="slate" hot={followDue > 0} icon={<FlagIcon size={18} />} onClick={() => navigate('/team')} />
        <Stat label="Done this week" value={data.doneThisWeek} tone="green" icon={<span className="text-base">✓</span>} onClick={() => navigate('/tasks?status=done')} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* Today's list */}
        <Section
          icon={<SunIcon size={16} />}
          tone="bg-amber-50 text-amber-600"
          title="Today's list"
          right={
            <span className="text-[13px] text-slate-500">
              {doneCount}/{todo.length} done
            </span>
          }
        >
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
          tone="bg-rose-50 text-rose-600"
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
        <Section
          icon={<span className="text-base">⚠</span>}
          tone="bg-orange-50 text-orange-600"
          title="Needs attention"
          right={overdue > 0 ? <span className="badge badge-overdue">{overdue} overdue</span> : <span className="text-xs text-slate-500">next 3 days</span>}
        >
          {data.overdueTasks.length === 0 && data.dueSoonTasks.length === 0 && <Empty icon="🧘" text="No overdue or upcoming task deadlines." />}
          <ul className="list">
            {[...data.overdueTasks, ...data.dueSoonTasks].map((t) => {
              const late = isPast(dayjs(t.dueDate).endOf('day'));
              return (
                <li key={t._id} className="lrow group">
                  <button
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-[11px] font-bold text-transparent transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 max-md:h-6 max-md:w-6"
                    onClick={() => finishTask(t)}
                    title="Mark done"
                    aria-label="Mark done"
                  >
                    ✓
                  </button>
                  <div className="grow clickable" onClick={() => navigate(`/tasks/${t._id}`)}>
                    <div className="title truncate">{t.title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={`font-semibold ${late ? 'text-red-600' : 'text-amber-600'}`}>{dueLabel(t.dueDate)}</span>
                      {t.project?.name && <span className="truncate">· {t.project.name}</span>}
                      {(t.priority === 'high' || t.priority === 'urgent') && <span className="text-slate-400">· {t.priority}</span>}
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              );
            })}
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
        <Section icon={<TargetIcon size={16} />} tone="bg-emerald-50 text-emerald-600" title="Team targets this week">
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
          tone="bg-violet-50 text-violet-600"
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
