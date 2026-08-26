/**
 * Morning digest: one notification (in-app + push) summarising the day.
 * Sent once per day at/after DIGEST_HOUR (default 9), weekdays only unless DIGEST_WEEKDAYS_ONLY=false.
 */
const dayjs = require('dayjs');
const Task = require('../models/Task');
const Target = require('../models/Target');
const DailyTodo = require('../models/DailyTodo');
const Reminder = require('../models/Reminder');
const Setting = require('../models/Setting');
const { notify } = require('./notify');

const hour = () => Number(process.env.DIGEST_HOUR ?? 9);
const minute = () => Number(process.env.DIGEST_MINUTE ?? 0);
const weekdaysOnly = () => process.env.DIGEST_WEEKDAYS_ONLY !== 'false';

async function buildDigest(now = dayjs()) {
  const todayStr = now.format('YYYY-MM-DD');
  const startOfDay = now.startOf('day').toDate();
  const endOfDay = now.endOf('day').toDate();
  const open = { $in: ['pending', 'inprogress', 'hold'] };
  const [daily, overdue, dueToday, followUps, reminders, targetsDue, inProgress] = await Promise.all([
    DailyTodo.findOne({ date: todayStr }),
    Task.countDocuments({ status: { $ne: 'done' }, dueDate: { $lt: startOfDay } }),
    Task.find({ status: { $ne: 'done' }, dueDate: { $gte: startOfDay, $lte: endOfDay } }).select('title'),
    Target.find({ status: open, followUpAt: { $lte: endOfDay } }).populate('members', 'name').select('title members followUpAt'),
    Reminder.find({ done: false, remindAt: { $gte: startOfDay, $lte: endOfDay } }).select('title remindAt'),
    Target.countDocuments({ status: open, targetDate: { $gte: startOfDay, $lte: endOfDay } }),
    Task.countDocuments({ status: 'inprogress' }),
  ]);

  const items = daily?.items || [];
  const timed = items.filter((i) => !i.done && i.scheduledAt).sort((a, b) => a.scheduledAt - b.scheduledAt);
  const lines = [];
  if (daily?.focus) lines.push(`🎯 Focus: ${daily.focus}`);
  if (items.length) lines.push(`☀ ${items.filter((i) => !i.done).length} to-do${items.length > 1 ? 's' : ''} today${timed.length ? ` — first at ${dayjs(timed[0].scheduledAt).format('hh:mm A')} (${timed[0].text})` : ''}`);
  else lines.push('☀ No to-do list for today yet');
  if (followUps.length) lines.push(`⚑ ${followUps.length} follow-up${followUps.length > 1 ? 's' : ''}: ${followUps.slice(0, 3).map((t) => `${t.title}${t.members?.length ? ` (${t.members.map((m) => m.name.split(' ')[0]).join(', ')})` : ''}`).join('; ')}${followUps.length > 3 ? '…' : ''}`);
  if (overdue) lines.push(`⚠ ${overdue} overdue task${overdue > 1 ? 's' : ''}`);
  if (dueToday.length) lines.push(`📌 Due today: ${dueToday.slice(0, 3).map((t) => t.title).join('; ')}${dueToday.length > 3 ? '…' : ''}`);
  if (targetsDue) lines.push(`🏁 ${targetsDue} team target${targetsDue > 1 ? 's' : ''} due today`);
  if (reminders.length) lines.push(`⏰ ${reminders.length} reminder${reminders.length > 1 ? 's' : ''}: ${reminders.slice(0, 3).map((r) => `${r.title} ${dayjs(r.remindAt).format('hh:mm A')}`).join('; ')}`);
  lines.push(`▶ ${inProgress} task${inProgress === 1 ? '' : 's'} in progress`);

  const attention = followUps.length + overdue + dueToday.length;
  const title = attention ? `Good morning — ${attention} thing${attention > 1 ? 's' : ''} need${attention > 1 ? '' : 's'} you today` : 'Good morning — a clear day ahead';
  return { title, body: lines.join('\n'), lines };
}

/** Send now (used by the manual endpoint). */
async function sendDigest() {
  const d = await buildDigest();
  await notify({ kind: 'system', title: d.title, body: d.body, link: '/' });
  await Setting.set('digest.lastSentOn', dayjs().format('YYYY-MM-DD'));
  return d;
}

/** Scheduler hook: send once per day at the configured time. */
async function processDigest(now) {
  if (weekdaysOnly() && [0, 6].includes(now.day())) return;
  if (now.hour() < hour() || (now.hour() === hour() && now.minute() < minute())) return;
  const todayStr = now.format('YYYY-MM-DD');
  const last = await Setting.get('digest.lastSentOn');
  if (last === todayStr) return;
  await sendDigest();
  console.log('[digest] sent for', todayStr);
}

module.exports = { buildDigest, sendDigest, processDigest };
