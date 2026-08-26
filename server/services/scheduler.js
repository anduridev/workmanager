/**
 * Reminder scheduler: runs every 30s and turns due follow-ups / reminders / to-do items / task due dates
 * into Notification documents, which the client polls and shows as toasts + browser notifications.
 */
const dayjs = require('dayjs');
const Target = require('../models/Target');
const Reminder = require('../models/Reminder');
const Task = require('../models/Task');
const DailyTodo = require('../models/DailyTodo');
const Notification = require('../models/Notification');
const { nextOccurrence } = require('./schedule');

const INTERVAL_MS = 30 * 1000;
let running = false;

const fmtTime = (d) => dayjs(d).format('hh:mm A');
const fmtMembers = (t) => (t.members || []).map((m) => m.name).filter(Boolean).join(', ');

/** Due = snoozed and snooze elapsed, or not snoozed and scheduled time elapsed. */
function dueFilter(field, now) {
  return { $or: [{ snoozedUntil: { $lte: now } }, { snoozedUntil: null, [field]: { $lte: now } }] };
}

async function processTargets(now) {
  const due = await Target.find({
    status: { $in: ['pending', 'inprogress', 'hold'] },
    followUpAt: { $ne: null },
    reminderSent: false,
    ...dueFilter('followUpAt', now.toDate()),
  }).populate('members', 'name');

  for (const t of due) {
    const who = fmtMembers(t);
    await Notification.create({
      kind: 'target',
      title: `Follow up: ${t.title}`,
      body: [who && `With ${who}`, `Scheduled ${fmtTime(t.followUpAt)}`, t.targetDate && `Target date ${dayjs(t.targetDate).format('DD MMM')}`]
        .filter(Boolean)
        .join(' · '),
      refType: 'Target',
      refId: t._id,
      link: `/team/${t._id}`,
    });
    const wasSnoozed = Boolean(t.snoozedUntil);
    t.snoozedUntil = undefined;
    if (t.followUpRepeat === 'none') {
      t.reminderSent = true;
    } else if (!wasSnoozed || !dayjs(t.followUpAt).isAfter(now)) {
      // Advance the schedule (a snooze of an already-advanced occurrence must not advance it again)
      const next = nextOccurrence(t.followUpAt, now, t.followUpRepeat);
      if (!next || (t.followUpUntil && dayjs(next).isAfter(t.followUpUntil))) {
        t.followUpAt = undefined; // schedule finished
      } else {
        t.followUpAt = next;
      }
    }
    await t.save();
  }
}

async function processReminders(now) {
  const due = await Reminder.find({ done: false, ...dueFilter('remindAt', now.toDate()) });
  for (const r of due) {
    await Notification.create({
      kind: 'reminder',
      title: r.title,
      body: [r.body, `Scheduled ${fmtTime(r.remindAt)}`].filter(Boolean).join(' · '),
      refType: 'Reminder',
      refId: r._id,
      link: '/reminders',
    });
    r.lastFiredAt = now.toDate();
    const wasSnoozed = Boolean(r.snoozedUntil);
    r.snoozedUntil = undefined;
    if (r.repeat === 'none') {
      r.done = true;
    } else if (!wasSnoozed || !dayjs(r.remindAt).isAfter(now)) {
      const next = nextOccurrence(r.remindAt, now, r.repeat, r.repeatDay);
      if (!next || (r.until && dayjs(next).isAfter(r.until))) r.done = true;
      else r.remindAt = next;
    }
    await r.save();
  }
}

// To-do items: notify `remindBefore` minutes ahead of scheduledAt (once per item)
async function processTodos(now) {
  const horizon = now.add(2, 'hour').toDate(); // largest lead we support is 60 min; keep the query small
  const docs = await DailyTodo.find({ 'items.scheduledAt': { $lte: horizon, $gte: now.subtract(1, 'day').toDate() } });
  for (const doc of docs) {
    let changed = false;
    for (const item of doc.items) {
      if (item.done || !item.scheduledAt || item.reminderSentAt) continue;
      if (item.remindBefore === null || item.remindBefore === undefined) continue;
      const fireAt = dayjs(item.scheduledAt).subtract(item.remindBefore, 'minute');
      if (fireAt.isAfter(now)) continue;
      const tooOld = dayjs(item.scheduledAt).isBefore(now.subtract(1, 'day'));
      if (!tooOld) {
        const minsLeft = Math.max(0, Math.round(dayjs(item.scheduledAt).diff(now, 'minute')));
        await Notification.create({
          kind: 'todo',
          title: minsLeft > 0 ? `In ${minsLeft} min: ${item.text}` : `Now: ${item.text}`,
          body: `Scheduled ${dayjs(item.scheduledAt).format('DD MMM, hh:mm A')}`,
          refType: 'DailyTodo',
          refId: item._id,
          link: `/today?date=${doc.date}`,
        });
      }
      item.reminderSentAt = now.toDate();
      changed = true;
    }
    if (changed) await doc.save();
  }
}

// Once per day (at/after 9:00) notify about tasks due today or overdue
async function processTaskDueDates(now) {
  if (now.hour() < 9) return;
  const todayStr = now.format('YYYY-MM-DD');
  const tasks = await Task.find({
    status: { $ne: 'done' },
    dueDate: { $lte: now.endOf('day').toDate() },
    $or: [{ dueReminderSentOn: { $exists: false } }, { dueReminderSentOn: { $ne: todayStr } }],
  });
  for (const t of tasks) {
    const overdue = dayjs(t.dueDate).isBefore(now.startOf('day'));
    await Notification.create({
      kind: 'task',
      title: overdue ? `Overdue task: ${t.title}` : `Task due today: ${t.title}`,
      body: overdue ? `Was due ${dayjs(t.dueDate).format('DD MMM')}` : '',
      refType: 'Task',
      refId: t._id,
      link: `/tasks/${t._id}`,
    });
    t.dueReminderSentOn = todayStr;
    await t.save();
  }
}

// Retry unsynced / errored Azure DevOps items every ~5 minutes
let azdoTicks = 0;
async function processAzdoRetry() {
  const azdo = require('./azdo');
  if (!azdo.enabled()) return;
  if (++azdoTicks % 10 !== 0) return;
  const pending = await azdo.pendingCounts();
  if (pending.projects || pending.tasks) {
    const r = await azdo.syncAll({ limit: 50 });
    console.log(`[azdo] retry: projects ${r.projects.synced} ok/${r.projects.failed} failed, tasks ${r.tasks.synced} ok/${r.tasks.failed} failed`);
  }
}

async function tick() {
  if (running) return;
  running = true;
  const now = dayjs();
  try {
    await processTargets(now);
    await processReminders(now);
    await processTodos(now);
    await processTaskDueDates(now);
    await processAzdoRetry();
  } catch (err) {
    console.error('[scheduler] error:', err.message);
  } finally {
    running = false;
  }
}

function startScheduler() {
  console.log(`[scheduler] started (every ${INTERVAL_MS / 1000}s, TZ=${process.env.TZ || 'system'})`);
  tick();
  setInterval(tick, INTERVAL_MS);
}

module.exports = { startScheduler, tick };
