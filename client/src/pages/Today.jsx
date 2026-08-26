import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Daily } from '../lib/api';
import { dayjs, today, fmtDate, isPast } from '../lib/date';
import { Empty } from '../components/ui';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { useIsMobile } from '../lib/useMedia';

const LEADS = [
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 15, label: '15 min before' },
  { value: 10, label: '10 min before' },
  { value: 0, label: 'At the time' },
  { value: '', label: 'No reminder' },
];

const timeOf = (d) => (d ? dayjs(d).format('HH:mm') : '');
const combine = (date, time) => (time ? dayjs(`${date}T${time}`).toISOString() : null);

export default function Today() {
  const [params, setParams] = useSearchParams();
  const [date, setDateState] = useState(params.get('date') || today());
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState({ text: '', date: params.get('date') || today(), time: '', remindBefore: 30 });
  const [editing, setEditing] = useState(null); // {id, text, date, time, remindBefore}
  const [focus, setFocus] = useState('');
  const toast = useToast();
  const isMobile = useIsMobile();
  const addRef = useRef(null);
  useEffect(() => {
    if (params.get('add')) {
      addRef.current?.focus();
      addRef.current?.scrollIntoView({ block: 'center' });
      const next = new URLSearchParams(params);
      next.delete('add');
      setParams(next, { replace: true });
    }
  }, [params]);

  const setDate = (d) => {
    setDateState(d);
    setDraft((x) => ({ ...x, date: d }));
    const next = new URLSearchParams(params);
    if (d === today()) next.delete('date');
    else next.set('date', d);
    setParams(next, { replace: true });
  };

  const load = async (d = date) => {
    const res = await Daily.get(d);
    setData(res);
    setFocus(res.focus || '');
    Daily.history(21).then(setHistory);
  };

  useEffect(() => {
    load(date);
  }, [date]);
  useEffect(() => {
    const p = params.get('date');
    if (p && p !== date) setDateState(p);
  }, [params]);

  const add = async (e) => {
    e.preventDefault();
    if (!draft.text.trim()) return;
    const payload = { text: draft.text.trim(), scheduledAt: combine(draft.date, draft.time), remindBefore: draft.time ? draft.remindBefore : null };
    const res = await Daily.addItem(draft.date, payload);
    if (draft.date === date) setData({ ...data, items: res.items });
    else toast.success(`Added to ${fmtDate(draft.date, 'ddd DD MMM')}`, draft.time ? `at ${dayjs(`${draft.date}T${draft.time}`).format('hh:mm A')}` : '');
    setDraft({ ...draft, text: '', time: '' });
    Daily.history(21).then(setHistory);
  };
  const toggle = async (item) => setData({ ...data, items: (await Daily.updateItem(date, item._id, { done: !item.done })).items });
  const remove = async (item) => setData({ ...data, items: (await Daily.removeItem(date, item._id)).items });
  const saveEdit = async () => {
    if (!editing.text.trim()) return;
    const payload = { text: editing.text.trim(), scheduledAt: combine(editing.date, editing.time), remindBefore: editing.time ? editing.remindBefore : null };
    let res = await Daily.updateItem(date, editing.id, payload);
    if (editing.date !== date) {
      res = await Daily.moveItem(date, editing.id, editing.date);
      toast.success(`Moved to ${fmtDate(editing.date, 'ddd DD MMM')}`);
    }
    setData({ ...data, items: res.items });
    setEditing(null);
    load(date);
  };
  const carryOver = async (ids) => {
    await Daily.carryOver(date, ids);
    toast.success(ids ? 'Item moved to this day' : 'All pending items moved here');
    load(date);
  };
  const saveFocus = async () => {
    if (focus === (data?.focus || '')) return;
    await Daily.setFocus(date, focus);
    toast.success('Focus saved');
  };

  const items = data?.items || [];
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const isToday = date === today();

  const leadLabel = (v) => LEADS.find((l) => String(l.value) === String(v ?? ''))?.label;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isToday ? 'Today' : fmtDate(date, 'dddd')}</h1>
          <div className="sub">{fmtDate(date, 'DD MMMM YYYY')}</div>
        </div>
        <div className="datenav">
          <button className="btn btn-sm" onClick={() => setDate(dayjs(date).subtract(1, 'day').format('YYYY-MM-DD'))}>
            ‹
          </button>
          <input className="input input-sm w-150" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn btn-sm" onClick={() => setDate(dayjs(date).add(1, 'day').format('YYYY-MM-DD'))}>
            ›
          </button>
          {!isToday && (
            <button className="btn btn-sm" onClick={() => setDate(today())}>
              Today
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px] max-md:gap-3">
        <div className="flex flex-col gap-4 max-md:gap-3">
          <div className="card">
            <div className="card-body">
              <div className="section-title">Main focus for the day</div>
              <input
                className="input focus-input"
                placeholder="What's the one thing that matters most today?"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                onBlur={saveFocus}
                onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>To-do list</h2>
              <div className="row">
                <span className="muted small">
                  {done}/{items.length}
                </span>
                <div className="progress" style={{ width: 120 }}>
                  <div style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
            <div className="card-body tight">
              <form onSubmit={add} className="todo-add">
                <input ref={addRef} className="input" placeholder="What do you need to do?" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} autoFocus={!isMobile} />
                <input className="input" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value || date })} title="Date" />
                <input className="input" type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} title="Time (optional)" />
                <select className="select" value={draft.remindBefore} onChange={(e) => setDraft({ ...draft, remindBefore: e.target.value === '' ? '' : Number(e.target.value) })} disabled={!draft.time} title="Reminder">
                  {LEADS.map((l) => (
                    <option key={String(l.value)} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <button className="btn btn-primary" disabled={!draft.text.trim() || !draft.date}>
                  Add
                </button>
              </form>
              {draft.time && draft.remindBefore !== '' && (
                <div className="xs muted" style={{ padding: '0 8px 8px' }}>
                  ⏰ You'll be reminded at {dayjs(`${draft.date}T${draft.time}`).subtract(Number(draft.remindBefore), 'minute').format('hh:mm A')}
                  {draft.date !== date && ` on ${fmtDate(draft.date, 'ddd DD MMM')}`}
                </div>
              )}
              {items.length === 0 && <Empty icon="🌱" text="Empty list. Add what you plan to get done." />}
              <ul>
                {items.map((i) => {
                  const late = i.scheduledAt && !i.done && isPast(i.scheduledAt);
                  return (
                    <li key={i._id} className={`todo-item ${i.done ? 'done' : ''}`}>
                      <input type="checkbox" checked={i.done} onChange={() => toggle(i)} />
                      {i.scheduledAt ? (
                        <span className={`badge ${late ? 'badge-overdue' : 'badge-soon'}`} style={{ minWidth: 76, justifyContent: 'center' }}>
                          {dayjs(i.scheduledAt).format('hh:mm A')}
                        </span>
                      ) : (
                        <span className="badge badge-outline" style={{ minWidth: 76, justifyContent: 'center' }}>
                          any time
                        </span>
                      )}
                      <span
                        className="txt clickable"
                        onClick={() => setEditing({ id: i._id, text: i.text, date, time: timeOf(i.scheduledAt), remindBefore: i.remindBefore ?? '' })}
                        title="Click to edit"
                      >
                        {i.text}
                        {i.scheduledAt && !i.done && i.remindBefore !== null && i.remindBefore !== undefined && (
                          <span className="xs muted" style={{ marginLeft: 6 }}>
                            ⏰ {leadLabel(i.remindBefore)}
                          </span>
                        )}
                        {i.carriedFrom && <span className="badge badge-outline" style={{ marginLeft: 6 }}>from {fmtDate(i.carriedFrom, 'DD MMM')}</span>}
                        {i.done && i.doneAt && <span className="xs muted" style={{ marginLeft: 6 }}>✓ {dayjs(i.doneAt).format('hh:mm A')}</span>}
                      </span>
                      <button className="btn btn-xs btn-ghost del" onClick={() => remove(i)} title="Delete">
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {data?.pendingFromPrevious?.length > 0 && (
            <div className="card" style={{ borderColor: '#fcd34d' }}>
              <div className="card-head">
                <h3>⏳ Unfinished from previous days ({data.pendingFromPrevious.length})</h3>
                <button className="btn btn-sm" onClick={() => carryOver(null)}>
                  Move all here
                </button>
              </div>
              <div className="card-body tight">
                <ul>
                  {data.pendingFromPrevious.map((p) => (
                    <li key={p._id} className="todo-item">
                      <span className="txt">
                        {p.text}{' '}
                        <span className="xs muted">
                          · {fmtDate(p.date, 'ddd DD MMM')}
                          {p.scheduledAt && ` ${dayjs(p.scheduledAt).format('hh:mm A')}`}
                        </span>
                      </span>
                      <button className="btn btn-xs" onClick={() => carryOver([String(p._id)])}>
                        Move here
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Last 3 weeks</h3>
          </div>
          <div className="card-body tight">
            {history.length === 0 && <Empty icon="📆" text="No history yet." />}
            <div className="history-strip">
              {history.map((h) => (
                <div key={h.date} className={`d ${h.date === date ? 'active' : ''}`} onClick={() => setDate(h.date)}>
                  <span>
                    {fmtDate(h.date, 'ddd DD MMM')}
                    {h.focus && <span className="muted xs"> · {h.focus.slice(0, 24)}</span>}
                  </span>
                  <span style={h.total && h.done === h.total ? { color: 'var(--success)' } : {}}>
                    {h.done}/{h.total}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <Modal
          title="Edit to-do"
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={!editing.text.trim() || !editing.date}>
                Save
              </button>
            </>
          }
        >
          <label className="field">
            What
            <input className="input" autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveEdit()} />
          </label>
          <div className="form-grid">
            <label className="field">
              Date
              <input className="input" type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            </label>
            <label className="field">
              Time (optional)
              <input className="input" type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} />
            </label>
            <label className="field full">
              Reminder
              <select className="select" value={editing.remindBefore} disabled={!editing.time} onChange={(e) => setEditing({ ...editing, remindBefore: e.target.value === '' ? '' : Number(e.target.value) })}>
                {LEADS.map((l) => (
                  <option key={String(l.value)} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {editing.time && editing.remindBefore !== '' && (
            <div className="small muted">⏰ Reminder at {dayjs(`${editing.date}T${editing.time}`).subtract(Number(editing.remindBefore), 'minute').format('ddd DD MMM, hh:mm A')}</div>
          )}
        </Modal>
      )}
    </>
  );
}
