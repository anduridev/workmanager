import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Reminders as RemApi } from '../lib/api';
import { dayjs, calendarDate, isPast, fmtDate } from '../lib/date';
import { specFromDate, describe, WEEKDAYS } from '../lib/schedule';
import ScheduleFields, { specToPayload, specValid } from '../components/ScheduleFields';
import { Empty } from '../components/ui';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

const REPEATS = [
  { value: 'none', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
const QUICK = [
  { label: 'In 1 hour', get: () => dayjs().add(1, 'hour') },
  { label: 'This evening 5 PM', get: () => dayjs().hour(17).minute(0) },
  { label: 'Tomorrow 9:30 AM', get: () => dayjs().add(1, 'day').hour(9).minute(30) },
  { label: 'Next Monday 9:30 AM', get: () => dayjs().add(1, 'week').day(1).hour(9).minute(30) },
];

const blank = () => ({ title: '', body: '', spec: specFromDate(dayjs().add(1, 'hour').minute(0), 'none') });

function repeatLabel(r) {
  if (r.repeat === 'none') return '';
  const t = dayjs(r.remindAt).format('hh:mm A');
  const until = r.until ? ` until ${fmtDate(r.until, 'DD MMM')}` : '';
  switch (r.repeat) {
    case 'daily':
      return `Daily ${t}${until}`;
    case 'weekdays':
      return `Mon–Fri ${t}${until}`;
    case 'weekly':
      return `Every ${WEEKDAYS[dayjs(r.remindAt).day()].slice(0, 3)} ${t}${until}`;
    case 'monthly':
      return `Monthly on ${r.repeatDay || dayjs(r.remindAt).date()} ${t}${until}`;
    default:
      return r.repeat;
  }
}

export default function Reminders() {
  const [list, setList] = useState([]);
  const [showDone, setShowDone] = useState(false);
  const [form, setForm] = useState(null);
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  const load = () => RemApi.list(showDone).then(setList);
  useEffect(() => {
    load();
  }, [showDone]);

  useEffect(() => {
    if (params.get('new')) {
      setForm(blank());
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params]);

  const save = async () => {
    const { at, until } = specToPayload(form.spec);
    if (!at) return toast.error('Pick a valid time');
    const payload = {
      title: form.title,
      body: form.body,
      remindAt: at,
      repeat: form.spec.repeat,
      repeatDay: form.spec.repeat === 'monthly' ? form.spec.monthDay : null,
      until,
    };
    try {
      if (form._id) await RemApi.update(form._id, payload);
      else await RemApi.create(payload);
      setForm(null);
      toast.success(form._id ? 'Reminder updated' : 'Reminder set', form.spec.repeat === 'none' ? calendarDate(at) : describe(form.spec));
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };
  const markDone = async (r) => {
    await RemApi.update(r._id, { done: !r.done });
    load();
  };
  const snooze = async (r, minutes) => {
    await RemApi.snooze(r._id, minutes);
    toast.success('Snoozed', r.repeat !== 'none' ? 'Only this occurrence — the schedule is unchanged' : '');
    load();
  };
  const remove = async (r) => {
    if (!window.confirm('Delete this reminder?')) return;
    await RemApi.remove(r._id);
    load();
  };
  const edit = (r) => setForm({ _id: r._id, title: r.title, body: r.body, spec: specFromDate(r.remindAt, r.repeat, { repeatDay: r.repeatDay, until: r.until }) });

  const upcoming = list.filter((r) => !r.done);
  const done = list.filter((r) => r.done);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reminders</h1>
          <div className="sub">Ad-hoc nudges — "call vendor at 3", "send weekly report every Friday".</div>
        </div>
        <div className="page-actions">
          <label className="checkbox small muted">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
          </label>
          <button className="btn btn-primary" onClick={() => setForm(blank())}>
            + New reminder
          </button>
        </div>
      </div>

      <div className="card">
        {upcoming.length === 0 && <Empty icon="⏰" text="No reminders scheduled." />}
        {upcoming.map((r) => {
          const effective = r.snoozedUntil || r.remindAt;
          return (
            <div key={r._id} className="rem-item">
              <input type="checkbox" checked={false} onChange={() => markDone(r)} title="Mark done" style={{ width: 17, height: 17, accentColor: 'var(--primary)' }} />
              <div className={`when ${isPast(effective) ? 'past' : ''}`}>
                {calendarDate(effective)}
                {r.snoozedUntil && <span className="badge badge-soon" style={{ marginLeft: 6 }}>snoozed</span>}
                {r.repeat !== 'none' && <div className="xs muted">↻ {repeatLabel(r)}</div>}
              </div>
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{r.title}</div>
                {r.body && <div className="muted small">{r.body}</div>}
              </div>
              <div className="acts">
                <button className="btn btn-xs" onClick={() => snooze(r, 30)}>
                  +30m
                </button>
                <button className="btn btn-xs" onClick={() => snooze(r, 24 * 60)}>
                  +1d
                </button>
                <button className="btn btn-xs btn-ghost" onClick={() => edit(r)}>
                  Edit
                </button>
                <button className="btn btn-xs btn-ghost btn-danger" onClick={() => remove(r)}>
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showDone && done.length > 0 && (
        <div className="card mt">
          <div className="card-head">
            <h3>Completed</h3>
          </div>
          {done.map((r) => (
            <div key={r._id} className="rem-item muted">
              <input type="checkbox" checked onChange={() => markDone(r)} style={{ width: 17, height: 17 }} />
              <div className="when">{calendarDate(r.remindAt)}</div>
              <div className="grow" style={{ textDecoration: 'line-through' }}>
                {r.title}
              </div>
              <div className="acts">
                <button className="btn btn-xs btn-ghost btn-danger" onClick={() => remove(r)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <Modal
          title={form._id ? 'Edit reminder' : 'New reminder'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={!form.title.trim() || !specValid(form.spec)}>
                {form._id ? 'Save' : 'Set reminder'}
              </button>
            </>
          }
        >
          <label className="field">
            Remind me to…
            <input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Call the client about UAT sign-off" />
          </label>
          <label className="field">
            Details (optional)
            <textarea className="textarea" style={{ minHeight: 60 }} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </label>
          <ScheduleFields spec={form.spec} onChange={(spec) => setForm({ ...form, spec })} repeats={REPEATS} quick={QUICK} />
        </Modal>
      )}
    </>
  );
}
