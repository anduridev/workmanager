import { dayjs } from './date';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Compute the first occurrence of a schedule (as a dayjs) that is not in the past.
 * spec: { repeat, time: 'HH:mm', weekday: 0-6, monthDay: 1-31, start: 'YYYY-MM-DD' | '', datetime: 'YYYY-MM-DDTHH:mm' }
 */
export function firstOccurrence(spec) {
  const now = dayjs();
  if (!spec.repeat || spec.repeat === 'none') {
    return spec.datetime ? dayjs(spec.datetime) : null;
  }
  if (!spec.time) return null;
  const [h, m] = spec.time.split(':').map(Number);
  const base = (spec.start ? dayjs(spec.start) : now).startOf('day');
  let c;
  switch (spec.repeat) {
    case 'daily':
    case 'weekdays':
      c = base.hour(h).minute(m).second(0);
      while (!c.isAfter(now) || (spec.repeat === 'weekdays' && [0, 6].includes(c.day()))) c = c.add(1, 'day');
      return c;
    case 'weekly': {
      const wd = Number(spec.weekday ?? 1);
      c = base.hour(h).minute(m).second(0);
      while (c.day() !== wd || !c.isAfter(now)) c = c.add(1, 'day');
      return c;
    }
    case 'monthly': {
      const day = Math.min(Math.max(Number(spec.monthDay || 1), 1), 31);
      c = base.startOf('month').hour(h).minute(m).second(0);
      c = c.date(Math.min(day, c.daysInMonth()));
      while (!c.isAfter(now) || c.isBefore(base)) {
        const n = c.add(1, 'month').startOf('month');
        c = n.date(Math.min(day, n.daysInMonth())).hour(h).minute(m).second(0);
      }
      return c;
    }
    default:
      return null;
  }
}

/** Break an existing occurrence back into form fields. */
export function specFromDate(d, repeat, extra = {}) {
  const x = d ? dayjs(d) : null;
  return {
    repeat: repeat || 'none',
    datetime: x ? x.format('YYYY-MM-DDTHH:mm') : '',
    time: x ? x.format('HH:mm') : '10:00',
    weekday: x ? x.day() : 1,
    monthDay: extra.repeatDay || (x ? x.date() : 1),
    start: x ? x.format('YYYY-MM-DD') : '',
    until: extra.until ? dayjs(extra.until).format('YYYY-MM-DD') : '',
  };
}

/** Human description of a schedule. */
export function describe(spec) {
  const t = spec.time ? dayjs(`2000-01-01T${spec.time}`).format('hh:mm A') : '';
  const range = [spec.start && `from ${dayjs(spec.start).format('DD MMM')}`, spec.until && `until ${dayjs(spec.until).format('DD MMM YYYY')}`].filter(Boolean).join(' ');
  switch (spec.repeat) {
    case 'daily':
      return `Every day at ${t} ${range}`.trim();
    case 'weekdays':
      return `Mon–Fri at ${t} ${range}`.trim();
    case 'weekly':
      return `Every ${WEEKDAYS[spec.weekday]} at ${t} ${range}`.trim();
    case 'monthly':
      return `Monthly on day ${spec.monthDay} at ${t} ${range}`.trim();
    default:
      return spec.datetime ? dayjs(spec.datetime).format('ddd DD MMM YYYY, hh:mm A') : 'Not scheduled';
  }
}

/** Shared form fragment logic: which fields to show for a repeat value. */
export const showsDatetime = (repeat) => !repeat || repeat === 'none';
export const showsWeekday = (repeat) => repeat === 'weekly';
export const showsMonthDay = (repeat) => repeat === 'monthly';
