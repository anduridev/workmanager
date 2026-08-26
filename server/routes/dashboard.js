const router = require('express').Router();
const dayjs = require('dayjs');
const Task = require('../models/Task');
const Target = require('../models/Target');
const DailyTodo = require('../models/DailyTodo');
const Reminder = require('../models/Reminder');
const Notification = require('../models/Notification');
const Note = require('../models/Note');
const wrap = require('../middleware/asyncHandler');

router.get(
  '/',
  wrap(async (req, res) => {
    const now = dayjs();
    const todayStr = now.format('YYYY-MM-DD');
    const endOfToday = now.endOf('day').toDate();
    const weekAhead = now.add(7, 'day').endOf('day').toDate();

    const [
      statusCounts,
      inProgress,
      overdueTasks,
      dueSoonTasks,
      followUpsDue,
      upcomingTargets,
      daily,
      reminders,
      unreadCount,
      recentNotes,
      doneThisWeek,
    ] = await Promise.all([
      Task.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Task.find({ status: 'inprogress' }).populate('project', 'name').sort({ updatedAt: -1 }).limit(8),
      Task.find({ status: { $nin: ['done'] }, dueDate: { $lt: now.startOf('day').toDate() } }).sort({ dueDate: 1 }),
      Task.find({ status: { $nin: ['done'] }, dueDate: { $gte: now.startOf('day').toDate(), $lte: weekAhead } }).sort({ dueDate: 1 }),
      Target.find({ status: { $in: ['pending', 'inprogress', 'hold'] }, followUpAt: { $lte: endOfToday } })
        .populate('members', 'name role')
        .sort({ followUpAt: 1 }),
      Target.find({ status: { $in: ['pending', 'inprogress', 'hold'] }, targetDate: { $lte: weekAhead } })
        .populate('members', 'name role')
        .sort({ targetDate: 1 })
        .limit(10),
      DailyTodo.findOne({ date: todayStr }),
      Reminder.find({ done: false, remindAt: { $lte: endOfToday } }).sort({ remindAt: 1 }),
      Notification.countDocuments({ read: false }),
      Note.find().sort({ date: -1, createdAt: -1 }).limit(5),
      Task.countDocuments({ status: 'done', completedAt: { $gte: now.startOf('week').toDate() } }),
    ]);

    const counts = { todo: 0, inprogress: 0, hold: 0, done: 0 };
    statusCounts.forEach((s) => (counts[s._id] = s.count));

    res.json({
      today: todayStr,
      counts,
      doneThisWeek,
      inProgress,
      overdueTasks,
      dueSoonTasks,
      followUpsDue,
      upcomingTargets,
      daily: daily ? { items: daily.items, focus: daily.focus } : { items: [], focus: '' },
      reminders,
      unreadCount,
      recentNotes,
    });
  })
);

module.exports = router;
