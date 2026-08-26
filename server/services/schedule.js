/**
 * Shared recurrence helpers (server side). Mirrors client/src/lib/schedule.js.
 */
const dayjs = require('dayjs');

/** Advance `from` by the repeat rule until it's strictly after `now`. Keeps time of day. */
function nextOccurrence(from, now, repeat, repeatDay) {
  let next = dayjs(from);
  const step = () => {
    switch (repeat) {
      case 'daily':
        return next.add(1, 'day');
      case 'weekdays': {
        let n = next.add(1, 'day');
        while ([0, 6].includes(n.day())) n = n.add(1, 'day');
        return n;
      }
      case 'weekly':
        return next.add(1, 'week');
      case 'monthly': {
        const day = repeatDay || next.date();
        let n = next.add(1, 'month').startOf('month');
        n = n.date(Math.min(day, n.daysInMonth())).hour(next.hour()).minute(next.minute()).second(0);
        return n;
      }
      default:
        return null;
    }
  };
  let guard = 0;
  while (!next.isAfter(now) && guard++ < 10000) {
    const n = step();
    if (!n) return null;
    next = n;
  }
  return next.toDate();
}

module.exports = { nextOccurrence };
