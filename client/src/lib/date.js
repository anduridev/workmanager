import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import calendar from 'dayjs/plugin/calendar';

dayjs.extend(relativeTime);
dayjs.extend(calendar);

export const today = () => dayjs().format('YYYY-MM-DD');
export const fmtDate = (d, f = 'DD MMM YYYY') => (d ? dayjs(d).format(f) : '');
export const fmtDateTime = (d) => (d ? dayjs(d).format('DD MMM, hh:mm A') : '');
export const fromNow = (d) => (d ? dayjs(d).fromNow() : '');
export const isPast = (d) => (d ? dayjs(d).isBefore(dayjs()) : false);
export const isToday = (d) => (d ? dayjs(d).isSame(dayjs(), 'day') : false);
export const calendarDate = (d) =>
  d
    ? dayjs(d).calendar(null, {
        sameDay: '[Today] hh:mm A',
        nextDay: '[Tomorrow] hh:mm A',
        nextWeek: 'ddd hh:mm A',
        lastDay: '[Yesterday] hh:mm A',
        lastWeek: '[Last] ddd hh:mm A',
        sameElse: 'DD MMM, hh:mm A',
      })
    : '';
/** Value for <input type="datetime-local"> */
export const toLocalInput = (d) => (d ? dayjs(d).format('YYYY-MM-DDTHH:mm') : '');
/** Value for <input type="date"> */
export const toDateInput = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : '');
export const dueLabel = (d) => {
  if (!d) return '';
  const diff = dayjs(d).startOf('day').diff(dayjs().startOf('day'), 'day');
  if (diff < 0) return `${-diff}d overdue`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  return `Due in ${diff}d`;
};
export { dayjs };
