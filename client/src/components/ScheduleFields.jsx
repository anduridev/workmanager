import { firstOccurrence, describe, showsDatetime, showsWeekday, showsMonthDay, WEEKDAYS } from '../lib/schedule';
import { dayjs, toLocalInput } from '../lib/date';

/**
 * Repeat-aware schedule picker. `spec` = { repeat, datetime, time, weekday, monthDay, start, until }.
 * `repeats` = list of allowed repeat options [{value,label}].
 */
export default function ScheduleFields({ spec, onChange, repeats, label = 'When', quick = [] }) {
  const set = (patch) => onChange({ ...spec, ...patch });
  const next = firstOccurrence(spec);
  const isOnce = showsDatetime(spec.repeat);

  return (
    <>
      <div className="form-grid">
        <label className="field">
          Repeat
          <select className="select" value={spec.repeat} onChange={(e) => set({ repeat: e.target.value })}>
            {repeats.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        {isOnce ? (
          <label className="field">
            {label} (date & time)
            <input className="input" type="datetime-local" value={spec.datetime} onChange={(e) => set({ datetime: e.target.value })} />
          </label>
        ) : (
          <label className="field">
            Time
            <input className="input" type="time" value={spec.time} onChange={(e) => set({ time: e.target.value })} />
          </label>
        )}

        {showsWeekday(spec.repeat) && (
          <label className="field">
            Day of week
            <select className="select" value={spec.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        {showsMonthDay(spec.repeat) && (
          <label className="field">
            Day of month
            <input className="input" type="number" min="1" max="31" value={spec.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })} />
          </label>
        )}
        {!isOnce && (
          <>
            <label className="field">
              Start from (optional)
              <input className="input" type="date" value={spec.start} onChange={(e) => set({ start: e.target.value })} />
            </label>
            <label className="field">
              Until (optional)
              <input className="input" type="date" value={spec.until} min={spec.start || undefined} onChange={(e) => set({ until: e.target.value })} />
            </label>
          </>
        )}
      </div>

      {isOnce && quick.length > 0 && (
        <div className="chips">
          {quick.map((qk) => (
            <button type="button" key={qk.label} className="chip" onClick={() => set({ datetime: toLocalInput(qk.get()) })}>
              ⏰ {qk.label}
            </button>
          ))}
        </div>
      )}

      <div className="small muted">
        {isOnce ? (
          next ? (
            <>
              Reminder at <b>{next.format('ddd DD MMM YYYY, hh:mm A')}</b>
              {next.isBefore(dayjs()) && <span style={{ color: 'var(--danger)' }}> — this time is in the past</span>}
            </>
          ) : (
            'Pick a date and time for the reminder.'
          )
        ) : (
          <>
            {describe(spec)}
            {next && (
              <>
                {' '}
                · first reminder <b>{next.format('ddd DD MMM, hh:mm A')}</b>
              </>
            )}
            {spec.until && spec.start && spec.until < spec.start && <span style={{ color: 'var(--danger)' }}> — "until" is before "start"</span>}
          </>
        )}
      </div>
    </>
  );
}

/** Build the API payload for a spec: { at: ISO|null, until: ISO|null } */
export function specToPayload(spec) {
  const next = firstOccurrence(spec);
  const until = spec.repeat !== 'none' && spec.until ? dayjs(spec.until).endOf('day').toISOString() : null;
  return { at: next ? next.toISOString() : null, until };
}

export function specValid(spec) {
  if (showsDatetime(spec.repeat)) return Boolean(spec.datetime);
  if (!spec.time) return false;
  if (spec.until && spec.start && spec.until < spec.start) return false;
  return true;
}
