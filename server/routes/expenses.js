const router = require('express').Router();
const dayjs = require('dayjs');
const Expense = require('../models/Expense');
const wrap = require('../middleware/asyncHandler');
const expenses = require('../services/expenses');
const ai = require('../services/ai');
const gmail = require('../services/gmail');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ---- Expense manager lock: the login password must be re-entered (unlock token valid 30 min, kept per browser tab) ----
const UNLOCK_SECRET = () => (process.env.JWT_SECRET || 'dev-secret-change-me') + ':expenses';
router.post(
  '/unlock',
  wrap(async (req, res) => {
    const user = await User.findById(req.user.sub);
    if (!user || !(await user.verifyPassword(req.body?.password))) return res.status(401).json({ error: 'Wrong password' });
    const token = jwt.sign({ sub: String(user._id), purpose: 'expenses' }, UNLOCK_SECRET(), { expiresIn: '30m' });
    res.json({ ok: true, token, expiresIn: 30 * 60 });
  })
);
router.use((req, res, next) => {
  const t = req.headers['x-expenses-unlock'];
  try {
    const p = jwt.verify(String(t || ''), UNLOCK_SECRET());
    if (p.purpose !== 'expenses' || p.sub !== req.user?.sub) throw new Error('bad');
    return next();
  } catch {
    return res.status(403).json({ error: 'Expense manager is locked — enter your password', locked: true });
  }
});
const parser = require('../services/expenseParser');

// List: month=YYYY-MM | from,to; type, category, account, source, q, includeExcluded, limit
router.get(
  '/',
  wrap(async (req, res) => {
    const { month, from, to, type, category, account, source, q, includeExcluded, limit } = req.query;
    const filter = {};
    if (month) {
      const start = dayjs(`${month}-01`).startOf('month');
      filter.date = { $gte: start.toDate(), $lte: start.endOf('month').toDate() };
    } else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = dayjs(from).startOf('day').toDate();
      if (to) filter.date.$lte = dayjs(to).endOf('day').toDate();
    }
    if (type && Expense.TYPES.includes(type)) filter.type = type;
    if (category) filter.category = category;
    if (account) filter.account = account;
    if (source) filter.source = source;
    if (includeExcluded !== 'true') filter.excluded = { $ne: true };
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ merchant: rx }, { description: rx }, { notes: rx }, { account: rx }, { category: rx }];
    }
    const list = await Expense.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(Math.min(2000, Number(limit) || 500))
      .lean();
    res.json(list);
  })
);

router.get(
  '/meta',
  wrap(async (req, res) => {
    const [accounts, merchants] = await Promise.all([
      Expense.distinct('account'),
      Expense.aggregate([{ $match: { merchant: { $ne: '' } } }, { $group: { _id: '$merchant', n: { $sum: 1 }, category: { $last: '$category' } } }, { $sort: { n: -1 } }, { $limit: 40 }]),
    ]);
    res.json({ categories: Expense.CATEGORIES, types: Expense.TYPES, accounts: accounts.filter(Boolean).sort(), merchants: merchants.map((m) => ({ merchant: m._id, category: m.category, n: m.n })) });
  })
);

router.get(
  '/summary',
  wrap(async (req, res) => {
    res.json(await expenses.summary(req.query.month));
  })
);

router.get(
  '/settings',
  wrap(async (req, res) => {
    res.json(await expenses.publicSettings(req));
  })
);

// ---- Gmail (Google sign-in). The OAuth callback itself is public: see routes/expensesPublic.js ----
router.get(
  '/gmail/auth-url',
  wrap(async (req, res) => {
    res.json({ url: gmail.authUrl(req), redirectUri: gmail.redirectUri(req) });
  })
);
router.post(
  '/gmail/disconnect',
  wrap(async (req, res) => {
    await gmail.disconnect();
    res.json(await expenses.publicSettings(req));
  })
);
router.post(
  '/gmail/test',
  wrap(async (req, res) => {
    try {
      res.json(await gmail.test());
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  })
);
router.put(
  '/settings',
  wrap(async (req, res) => {
    res.json(await expenses.saveSettings(req.body || {}));
  })
);
router.post(
  '/settings/test-mail',
  wrap(async (req, res) => {
    try {
      res.json(await expenses.testMail(req.body || {}));
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  })
);
router.post(
  '/settings/test-ai',
  wrap(async (req, res) => {
    try {
      res.json(await ai.test({ key: req.body?.key?.trim() || undefined, model: req.body?.model || undefined }));
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  })
);

// Read the mailbox now (body: { days, full })
router.post(
  '/sync',
  wrap(async (req, res) => {
    const r = await expenses.syncMail({ days: req.body?.days, full: req.body?.full === true, reimport: req.body?.reimport === true });
    res.json(r);
  })
);

// What the scan sees (diagnostic; nothing stored). body: { days }
router.post(
  '/scan-preview',
  wrap(async (req, res) => {
    res.json(await expenses.scanPreview({ days: Number(req.body?.days) || 30, limit: Number(req.body?.limit) || 60, textChars: Number(req.body?.textChars) || 160 }));
  })
);

// One cheap OpenAI pass over the distinct merchants -> categories (rows you categorised by hand are untouched)
router.post(
  '/ai-categorize',
  wrap(async (req, res) => {
    res.json(await expenses.aiCategorize({ month: req.body?.month, onlyOther: req.body?.onlyOther === true }));
  })
);

router.get(
  '/insights',
  wrap(async (req, res) => {
    const [insights, alerts] = await Promise.all([expenses.getInsights(), expenses.checkAlerts(dayjs(), { quiet: true })]);
    res.json({ insights, ruleAlerts: alerts.alerts, aiEnabled: await ai.enabled() });
  })
);
router.post(
  '/insights',
  wrap(async (req, res) => {
    res.json(await expenses.generateInsights({ reason: 'manual' }));
  })
);

// Try the parser on pasted text (handy to check what a bank mail would produce)
router.post(
  '/parse-preview',
  wrap(async (req, res) => {
    const m = { subject: req.body?.subject || '', text: req.body?.text || '', from: req.body?.from || '', fromName: '', date: new Date() };
    res.json({ rules: parser.parseRules(m) });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const body = pick(req.body);
    if (!(body.amount > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
    const doc = await Expense.create({ ...body, source: 'manual', fingerprint: parser.fingerprint({ ...body, date: body.date || new Date() }) });
    res.status(201).json(doc);
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    const doc = await Expense.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Expense not found' });
    const before = doc.category;
    Object.assign(doc, pick(req.body));
    if (!(doc.amount > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
    if (doc.category !== before) doc.userCategory = true; // remembered for future imports of the same merchant
    await doc.save();
    let learned = 0;
    if (doc.userCategory && doc.merchant && req.body.applyToMerchant !== false) {
      // Teach the app: other rows of this merchant that were only rule/AI-categorised follow the correction
      const r = await Expense.updateMany({ _id: { $ne: doc._id }, merchant: doc.merchant, userCategory: { $ne: true } }, { $set: { category: doc.category } });
      learned = r.modifiedCount || 0;
    }
    res.json({ ...doc.toObject(), learned });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await Expense.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

function pick(body = {}) {
  const out = {};
  ['merchant', 'description', 'account', 'method', 'notes', 'currency'].forEach((k) => {
    if (body[k] !== undefined) out[k] = String(body[k] ?? '').trim();
  });
  if (body.date !== undefined) out.date = body.date ? dayjs(body.date).toDate() : new Date();
  if (body.amount !== undefined) out.amount = Math.round(Number(body.amount) * 100) / 100;
  if (body.type !== undefined) out.type = Expense.TYPES.includes(body.type) ? body.type : 'debit';
  if (body.category !== undefined) out.category = String(body.category || 'Other').trim() || 'Other';
  if (body.excluded !== undefined) out.excluded = Boolean(body.excluded);
  if (body.tags !== undefined) out.tags = (Array.isArray(body.tags) ? body.tags : String(body.tags).split(',')).map((t) => String(t).trim()).filter(Boolean);
  if (out.currency) out.currency = out.currency.toUpperCase().slice(0, 3);
  return out;
}

module.exports = router;
