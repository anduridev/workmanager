/**
 * Personal Expense Manager: settings (mailbox + OpenAI, secrets encrypted), e-mail sync, monthly summary,
 * rule-based overspend alerts and AI insights.
 */
const dayjs = require('dayjs');
const Expense = require('../models/Expense');
const Setting = require('../models/Setting');
const mail = require('./mail');
const gmail = require('./gmail');
const ai = require('./ai');
const parser = require('./expenseParser');
const { encrypt, decrypt, mask } = require('./secrets');
const { notify } = require('./notify');

const MAIL_KEY = 'expense.mail';
const AI_KEY = 'expense.openai';
const PREFS_KEY = 'expense.prefs';
const INSIGHTS_KEY = 'expense.insights';
const ALERTED_KEY = 'expense.alerted';

const DEFAULT_PREFS = { currency: 'INR', largeTxn: 10000, alertRatio: 1.3, autoSync: true, syncHours: 6, weeklyReview: true };

const fmtMoney = (n, cur = 'INR') => {
  const v = Math.round(Number(n) || 0);
  if (cur === 'INR') return `₹${v.toLocaleString('en-IN')}`;
  return `${cur} ${v.toLocaleString('en-US')}`;
};

// ---------- settings ----------
async function mailSettings() {
  const s = (await Setting.get(MAIL_KEY)) || {};
  return { ...s, pass: decrypt(s.passEnc) };
}
async function prefs() {
  return { ...DEFAULT_PREFS, ...((await Setting.get(PREFS_KEY)) || {}) };
}
/** Which mailbox path is active: Google sign-in (gmail) or IMAP credentials. */
async function activeProvider(mailCfg, g) {
  const conn = g || (await gmail.connection());
  if (mailCfg.provider === 'gmail' && conn.connected) return 'gmail';
  if (mailCfg.host && mailCfg.user && decrypt(mailCfg.passEnc)) return 'imap';
  return conn.connected ? 'gmail' : '';
}

async function publicSettings(req) {
  const [m, a, p, ins, g] = await Promise.all([Setting.get(MAIL_KEY), ai.settings(), prefs(), Setting.get(INSIGHTS_KEY), gmail.connection()]);
  const mailCfg = m || {};
  const provider = await activeProvider(mailCfg, g);
  return {
    gmail: { configured: gmail.configured(), ...g, redirectUri: gmail.redirectUri(req) },
    mail: {
      provider,
      host: mailCfg.host || '',
      port: mailCfg.port || 993,
      secure: mailCfg.secure !== false,
      user: mailCfg.user || '',
      folder: mailCfg.folder || 'INBOX',
      senders: mailCfg.senders || [],
      lookbackDays: mailCfg.lookbackDays || 30,
      hasPassword: Boolean(decrypt(mailCfg.passEnc)),
      imapConfigured: Boolean(mailCfg.host && mailCfg.user && decrypt(mailCfg.passEnc)),
      configured: Boolean(provider),
      lastSyncAt: mailCfg.lastSyncAt || null,
      lastError: mailCfg.lastError || '',
      lastResult: mailCfg.lastResult || null,
      lastUid: mailCfg.lastUid || 0,
    },
    ai: { hasKey: Boolean(a.key), keyMasked: a.key ? mask(a.key) : '', fromEnv: a.fromEnv, model: a.model, models: ai.MODELS },
    prefs: p,
    insightsAt: ins?.generatedAt || null,
  };
}

async function saveSettings(body = {}) {
  if (body.mail) {
    const cur = (await Setting.get(MAIL_KEY)) || {};
    const m = body.mail;
    const next = {
      ...cur,
      host: String(m.host ?? cur.host ?? '').trim(),
      port: Number(m.port ?? cur.port ?? 993) || 993,
      secure: m.secure === undefined ? cur.secure !== false : m.secure !== false && m.secure !== 'false',
      user: String(m.user ?? cur.user ?? '').trim(),
      folder: String(m.folder ?? cur.folder ?? 'INBOX').trim() || 'INBOX',
      senders: Array.isArray(m.senders) ? m.senders.map((s) => String(s).trim()).filter(Boolean) : typeof m.senders === 'string' ? m.senders.split(',').map((s) => s.trim()).filter(Boolean) : cur.senders || [],
      lookbackDays: Math.min(365, Math.max(1, Number(m.lookbackDays ?? cur.lookbackDays ?? 30) || 30)),
    };
    if (typeof m.pass === 'string' && m.pass.trim()) next.passEnc = encrypt(m.pass.trim());
    if (m.clearPassword) next.passEnc = '';
    if (m.provider === 'gmail' || m.provider === 'imap') next.provider = m.provider;
    else if (next.host && next.user && next.passEnc && next.provider !== 'gmail') next.provider = 'imap';
    // Mailbox / folder changed -> start again from scratch (UIDs are per mailbox)
    if (next.host !== cur.host || next.user !== cur.user || next.folder !== cur.folder) {
      next.lastUid = 0;
      next.lastError = '';
    }
    await Setting.set(MAIL_KEY, next);
  }
  if (body.ai) {
    const cur = (await Setting.get(AI_KEY)) || {};
    const next = { ...cur };
    if (typeof body.ai.key === 'string' && body.ai.key.trim()) next.keyEnc = encrypt(body.ai.key.trim());
    if (body.ai.clearKey) next.keyEnc = '';
    if (body.ai.model) next.model = ai.MODELS.includes(body.ai.model) ? body.ai.model : String(body.ai.model).trim().slice(0, 40);
    await Setting.set(AI_KEY, next);
  }
  if (body.prefs) {
    const cur = await prefs();
    const p = body.prefs;
    await Setting.set(PREFS_KEY, {
      ...cur,
      currency: String(p.currency || cur.currency).toUpperCase().slice(0, 3),
      largeTxn: Math.max(0, Number(p.largeTxn ?? cur.largeTxn) || 0),
      alertRatio: Math.min(5, Math.max(1.05, Number(p.alertRatio ?? cur.alertRatio) || 1.3)),
      autoSync: p.autoSync === undefined ? cur.autoSync : Boolean(p.autoSync),
      syncHours: Math.min(48, Math.max(1, Number(p.syncHours ?? cur.syncHours) || 6)),
      weeklyReview: p.weeklyReview === undefined ? cur.weeklyReview : Boolean(p.weeklyReview),
    });
  }
  return publicSettings();
}

/** Test the mailbox with the submitted form (unsaved password allowed) or the stored one. */
async function testMail(form = {}) {
  const stored = await mailSettings();
  const cfg = { ...stored, ...form, pass: form.pass && form.pass.trim() ? form.pass.trim() : stored.pass };
  return mail.test(cfg);
}

// ---------- e-mail sync ----------
let syncing = false;
async function syncMail({ days, full = false, reimport = false, limit = 200 } = {}) {
  if (syncing) throw Object.assign(new Error('A mailbox sync is already running'), { status: 409 });
  syncing = true;
  const startedAt = new Date();
  const cfg = await mailSettings();
  try {
    if (reimport) {
      // Re-parse everything: drop mail-sourced rows (manual entries are kept) and scan from scratch
      const r = await Expense.deleteMany({ source: 'email' });
      console.log(`[expenses] re-import: removed ${r.deletedCount} mail-sourced transaction(s)`);
      full = true;
    }
    const provider = await activeProvider(cfg);
    if (!provider) throw new Error('Mailbox is not set up yet — open Expenses → Settings and connect Gmail');
    const sinceDays = Number(days) || cfg.lookbackDays || 30;
    const p = await prefs();
    const result = { fetched: 0, scanned: 0, matched: 0, transactions: 0, added: 0, duplicates: 0, ignored: 0, ai: 0, large: 0, rounds: 0 };
    const added = [];
    let afterUid = full ? 0 : cfg.lastUid || 0;
    let afterEpoch = full ? 0 : cfg.lastAfter || 0;
    let fetched;
    // Gmail hands back candidates oldest-first in batches; keep going until the batch is not truncated (max 8 rounds)
    do {
      fetched = provider === 'gmail' ? await gmail.fetchBankEmails(cfg, { sinceDays, afterEpoch, limit }) : await mail.fetchBankEmails(cfg, { sinceDays, afterUid, limit });
      result.rounds++;
      result.fetched += fetched.emails.length;
      result.scanned = Math.max(result.scanned, fetched.scanned);
      result.matched = Math.max(result.matched, fetched.matched);
      const parsed = await parser.parseMails(fetched.emails);
      for (const { mail: m, txn, via } of parsed) {
        if (!txn) {
          result.ignored++;
          continue;
        }
        result.transactions++;
        if (via === 'ai') result.ai++;
        const fp = parser.fingerprint(txn);
        const dup = await Expense.findOne({ $or: [{ 'email.messageId': m.messageId }, { fingerprint: fp }] }).select('_id');
        if (dup) {
          result.duplicates++;
          continue;
        }
        try {
          const doc = await Expense.create({
            date: txn.date,
            amount: txn.amount,
            currency: txn.currency || p.currency,
            type: txn.type,
            merchant: txn.merchant || '',
            description: txn.description || '',
            category: txn.category || 'Other',
            account: txn.account || '',
            method: txn.method || '',
            source: 'email',
            email: { messageId: m.messageId, uid: m.uid, gmailId: m.gmailId, subject: (m.subject || '').slice(0, 200), from: m.from, receivedAt: m.date },
            fingerprint: fp,
            ai: { category: txn.category, confidence: txn.confidence, via },
          });
          added.push(doc);
          result.added++;
        } catch (e) {
          if (e.code === 11000) result.duplicates++;
          else throw e;
        }
      }
      // persist the cursor after every round so an interrupted sync resumes instead of restarting
      if (provider === 'gmail') afterEpoch = fetched.maxAfter || afterEpoch;
      else afterUid = Math.max(afterUid, fetched.maxUid || 0);
      const cursor = provider === 'gmail' ? { lastAfter: afterEpoch } : { lastUid: afterUid };
      await Setting.set(MAIL_KEY, { ...(await Setting.get(MAIL_KEY)), ...cursor, provider, lastSyncAt: startedAt, lastError: '', lastResult: { ...result, provider } });
    } while (fetched.truncated && result.rounds < 8);
    // Large debits are worth a nudge right away
    const big = added.filter((t) => t.type === 'debit' && !t.excluded && p.largeTxn > 0 && t.amount >= p.largeTxn);
    for (const t of big.slice(0, 5)) {
      result.large++;
      await notify({ kind: 'expense', title: `Large spend: ${fmtMoney(t.amount, t.currency)} at ${t.merchant || t.description || 'unknown'}`, body: `${dayjs(t.date).format('DD MMM')} · ${t.category}${t.account ? ` · ${t.account}` : ''}`, refType: 'Expense', refId: t._id, link: '/expenses' });
    }
    if (added.length) await checkAlerts(dayjs(), { quiet: false }).catch((e) => console.warn('[expenses] alerts:', e.message));
    return result;
  } catch (e) {
    await Setting.set(MAIL_KEY, { ...(await Setting.get(MAIL_KEY)), lastSyncAt: startedAt, lastError: e.message }).catch(() => {});
    throw e;
  } finally {
    syncing = false;
  }
}

/** Diagnostic: what the mailbox scan sees (last `days`), with the rule parser's verdict per mail. Nothing is stored. */
async function scanPreview({ days = 30, limit = 60, textChars = 160 } = {}) {
  const cfg = await mailSettings();
  const provider = await activeProvider(cfg);
  if (!provider) throw new Error('Mailbox is not set up yet');
  const fetched = provider === 'gmail' ? await gmail.fetchBankEmails(cfg, { sinceDays: days, afterEpoch: 0, limit }) : await mail.fetchBankEmails(cfg, { sinceDays: days, afterUid: 0, limit });
  const known = new Set((await Expense.find({ 'email.messageId': { $in: fetched.emails.map((m) => m.messageId) } }).select('email.messageId').lean()).map((d) => d.email.messageId));
  const items = fetched.emails
    .map((m) => {
      const txn = parser.parseRules(m);
      return {
        date: m.date,
        from: m.fromName ? `${m.fromName} <${m.from}>` : m.from,
        subject: m.subject,
        bankLike: m.bankLike !== false,
        imported: known.has(m.messageId),
        txn: txn ? { type: txn.type, amount: txn.amount, merchant: txn.merchant, category: txn.category } : null,
        snippet: String(m.text || '').slice(0, Math.min(3000, Math.max(80, Number(textChars) || 160))),
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return { provider, days, scanned: fetched.scanned, matched: fetched.matched, downloaded: fetched.emails.length, items };
}

// ---------- summary ----------
const monthRange = (monthKey) => {
  const start = dayjs(monthKey ? `${monthKey}-01` : undefined).startOf('month');
  return { start, end: start.endOf('month'), key: start.format('YYYY-MM') };
};

/** Totals per month for the last `n` months (ending with `end` month key) — excluded transactions are ignored. */
async function monthlyTotals(endKey, n = 6) {
  const { start: endStart } = monthRange(endKey);
  const from = endStart.subtract(n - 1, 'month').startOf('month');
  const to = endStart.endOf('month');
  const rows = await Expense.aggregate([
    { $match: { date: { $gte: from.toDate(), $lte: to.toDate() }, excluded: { $ne: true } } },
    { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$date', timezone: process.env.TZ || 'Asia/Kolkata' } }, type: '$type', category: '$category' }, total: { $sum: '$amount' }, n: { $sum: 1 } } },
  ]);
  const months = [];
  for (let i = 0; i < n; i++) {
    const key = from.add(i, 'month').format('YYYY-MM');
    months.push({ month: key, label: from.add(i, 'month').format('MMM'), debit: 0, credit: 0, count: 0, byCategory: {} });
  }
  const byKey = new Map(months.map((m) => [m.month, m]));
  rows.forEach((r) => {
    const m = byKey.get(r._id.m);
    if (!m) return;
    m[r._id.type] += r.total;
    m.count += r.n;
    if (r._id.type === 'debit') m.byCategory[r._id.category] = (m.byCategory[r._id.category] || 0) + r.total;
  });
  return months;
}

async function summary(monthKey) {
  const { start, end, key } = monthRange(monthKey);
  const p = await prefs();
  const [txns, trend] = await Promise.all([Expense.find({ date: { $gte: start.toDate(), $lte: end.toDate() } }).sort({ date: -1 }).lean(), monthlyTotals(key, 6)]);
  const included = txns.filter((t) => !t.excluded);
  const debits = included.filter((t) => t.type === 'debit');
  const credits = included.filter((t) => t.type === 'credit');
  const sum = (arr) => Math.round(arr.reduce((a, t) => a + t.amount, 0) * 100) / 100;
  const spent = sum(debits);
  const income = sum(credits);
  const cat = {};
  debits.forEach((t) => {
    cat[t.category] = cat[t.category] || { category: t.category, total: 0, count: 0 };
    cat[t.category].total += t.amount;
    cat[t.category].count++;
  });
  const byCategory = Object.values(cat)
    .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100, pct: spent ? Math.round((c.total / spent) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
  const mer = {};
  debits.forEach((t) => {
    const k = (t.merchant || t.description || 'Unknown').trim();
    mer[k] = mer[k] || { merchant: k, total: 0, count: 0, category: t.category };
    mer[k].total += t.amount;
    mer[k].count++;
  });
  const topMerchants = Object.values(mer)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((m) => ({ ...m, total: Math.round(m.total * 100) / 100 }));
  const days = end.date();
  const byDay = Array.from({ length: days }, (_, i) => ({ day: i + 1, total: 0 }));
  debits.forEach((t) => (byDay[dayjs(t.date).date() - 1].total += t.amount));
  const acc = {};
  included.forEach((t) => {
    const k = t.account || 'Unspecified';
    acc[k] = acc[k] || { account: k, debit: 0, credit: 0, count: 0 };
    acc[k][t.type] += t.amount;
    acc[k].count++;
  });
  const isCurrent = key === dayjs().format('YYYY-MM');
  const dayOfMonth = isCurrent ? dayjs().date() : days;
  const prevMonths = trend.slice(0, 5);
  const withData = prevMonths.filter((m) => m.count > 0);
  const avg3 = withData.slice(-3);
  const avgSpent = avg3.length ? avg3.reduce((a, m) => a + m.debit, 0) / avg3.length : 0;
  const prev = trend[trend.length - 2] || { debit: 0, credit: 0 };
  const projected = isCurrent && dayOfMonth >= 3 ? (spent / dayOfMonth) * days : spent;
  return {
    month: key,
    label: start.format('MMMM YYYY'),
    currency: p.currency,
    spent,
    income,
    net: Math.round((income - spent) * 100) / 100,
    count: txns.length,
    included: included.length,
    excludedCount: txns.length - included.length,
    fromEmail: txns.filter((t) => t.source === 'email').length,
    uncategorized: debits.filter((t) => t.category === 'Other').length,
    dailyAvg: dayOfMonth ? Math.round(spent / dayOfMonth) : 0,
    projected: Math.round(projected),
    prevSpent: Math.round(prev.debit),
    prevIncome: Math.round(prev.credit),
    avgSpent: Math.round(avgSpent),
    vsPrevPct: prev.debit ? Math.round(((spent - prev.debit) / prev.debit) * 100) : null,
    vsAvgPct: avgSpent ? Math.round(((projected - avgSpent) / avgSpent) * 100) : null,
    byCategory,
    topMerchants,
    byDay: byDay.map((d) => ({ ...d, total: Math.round(d.total) })),
    accounts: Object.values(acc).sort((a, b) => b.debit - a.debit),
    largest: [...debits].sort((a, b) => b.amount - a.amount).slice(0, 5),
    trend: trend.map((m) => ({ month: m.month, label: m.label, debit: Math.round(m.debit), credit: Math.round(m.credit), count: m.count })),
    isCurrent,
  };
}

// ---------- rule-based alerts ----------
/**
 * Once a month per category: projected spend > alertRatio × 3-month average (and material in absolute terms).
 * Also one "on track to overspend" alert for the total. Notifications carry the numbers.
 */
async function checkAlerts(now = dayjs(), { quiet = false } = {}) {
  const key = now.format('YYYY-MM');
  const day = now.date();
  const daysInMonth = now.daysInMonth();
  if (day < 5) return { alerts: [] }; // too early in the month to project anything
  const p = await prefs();
  const trend = await monthlyTotals(key, 4);
  const cur = trend[trend.length - 1];
  const prev = trend.slice(0, 3).filter((m) => m.count > 0);
  if (!prev.length || !cur.count) return { alerts: [] };
  const alerted = (await Setting.get(ALERTED_KEY)) || {};
  const done = new Set(alerted[key] || []);
  const scale = daysInMonth / day;
  const out = [];
  const cats = new Set(prev.flatMap((m) => Object.keys(m.byCategory)).concat(Object.keys(cur.byCategory)));
  for (const c of cats) {
    if (['Transfers', 'Investments & Insurance', 'Salary & Income', 'Refunds', 'Rent & EMI'].includes(c)) continue;
    const avg = prev.reduce((a, m) => a + (m.byCategory[c] || 0), 0) / prev.length;
    const mtd = cur.byCategory[c] || 0;
    const projected = mtd * scale;
    if (avg > 0 && projected > avg * p.alertRatio && mtd >= 1000 && projected - avg >= 500) {
      out.push({ key: `cat:${c}`, level: projected > avg * 1.75 ? 'high' : 'medium', title: `${c} is running ${Math.round(((projected - avg) / avg) * 100)}% above usual`, detail: `${fmtMoney(mtd, p.currency)} so far (on track for ${fmtMoney(projected, p.currency)}) vs your ${fmtMoney(avg, p.currency)} monthly average.` });
    } else if (avg === 0 && mtd >= 5000) {
      out.push({ key: `new:${c}`, level: 'low', title: `New spending in ${c}`, detail: `${fmtMoney(mtd, p.currency)} this month — nothing in this category over the previous ${prev.length} month(s).` });
    }
  }
  const avgTotal = prev.reduce((a, m) => a + m.debit, 0) / prev.length;
  const projTotal = cur.debit * scale;
  if (avgTotal > 0 && projTotal > avgTotal * 1.2 && cur.debit >= 5000) {
    out.push({ key: 'total', level: projTotal > avgTotal * 1.5 ? 'high' : 'medium', title: `On track to spend ${fmtMoney(projTotal, p.currency)} this month`, detail: `${Math.round(((projTotal - avgTotal) / avgTotal) * 100)}% above your ${fmtMoney(avgTotal, p.currency)} average. ${fmtMoney(cur.debit, p.currency)} spent in ${day} days.` });
  }
  const fresh = out.filter((a) => !done.has(a.key));
  if (fresh.length && !quiet) {
    for (const a of fresh) await notify({ kind: 'expense', title: a.title, body: a.detail, link: '/expenses' });
  }
  if (fresh.length) await Setting.set(ALERTED_KEY, { ...alerted, [key]: [...done, ...fresh.map((a) => a.key)] });
  return { alerts: out, notified: fresh.length };
}

// ---------- AI insights ----------
async function insightStats() {
  const now = dayjs();
  const key = now.format('YYYY-MM');
  const p = await prefs();
  const trend = await monthlyTotals(key, 6);
  const since = now.subtract(90, 'day').startOf('day').toDate();
  const recent = await Expense.find({ date: { $gte: since }, excluded: { $ne: true } }).select('date amount type merchant category account method description').lean();
  const debits = recent.filter((t) => t.type === 'debit');
  const mer = {};
  debits.forEach((t) => {
    const k = (t.merchant || t.description || 'Unknown').trim();
    mer[k] = mer[k] || { merchant: k, total: 0, count: 0, category: t.category, months: new Set(), amounts: [] };
    mer[k].total += t.amount;
    mer[k].count++;
    mer[k].months.add(dayjs(t.date).format('YYYY-MM'));
    mer[k].amounts.push(t.amount);
  });
  const merchants = Object.values(mer).sort((a, b) => b.total - a.total);
  const recurring = merchants
    .filter((m) => m.months.size >= 2 && Math.max(...m.amounts) - Math.min(...m.amounts) <= Math.max(50, Math.max(...m.amounts) * 0.15))
    .slice(0, 15)
    .map((m) => ({ merchant: m.merchant, category: m.category, monthly: Math.round(m.total / m.months.size), months: m.months.size }));
  const weekend = debits.filter((t) => [0, 6].includes(dayjs(t.date).day())).reduce((a, t) => a + t.amount, 0);
  const weekday = debits.reduce((a, t) => a + t.amount, 0) - weekend;
  const hour = {};
  debits.forEach((t) => {
    const h = dayjs(t.date).hour();
    const b = h < 6 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'late';
    hour[b] = (hour[b] || 0) + t.amount;
  });
  const income90 = recent.filter((t) => t.type === 'credit' && t.category === 'Salary & Income').reduce((a, t) => a + t.amount, 0);
  const spend90 = debits.reduce((a, t) => a + t.amount, 0);
  return {
    currency: p.currency,
    today: now.format('YYYY-MM-DD'),
    dayOfMonth: now.date(),
    daysInMonth: now.daysInMonth(),
    txnCount: recent.length,
    months: trend.map((m) => ({ month: m.month, spent: Math.round(m.debit), income: Math.round(m.credit), count: m.count, byCategory: Object.fromEntries(Object.entries(m.byCategory).map(([k, v]) => [k, Math.round(v)]).sort((a, b) => b[1] - a[1])) })),
    last90Days: { spent: Math.round(spend90), salaryIncome: Math.round(income90), savingsRatePct: income90 ? Math.round(((income90 - spend90) / income90) * 100) : null, weekendSharePct: spend90 ? Math.round((weekend / spend90) * 100) : null, weekdaySpend: Math.round(weekday), byTimeOfDay: Object.fromEntries(Object.entries(hour).map(([k, v]) => [k, Math.round(v)])) },
    topMerchants90: merchants.slice(0, 15).map((m) => ({ merchant: m.merchant, category: m.category, total: Math.round(m.total), count: m.count })),
    recurring,
    largest90: [...debits].sort((a, b) => b.amount - a.amount).slice(0, 8).map((t) => ({ date: dayjs(t.date).format('YYYY-MM-DD'), amount: Math.round(t.amount), merchant: t.merchant || t.description, category: t.category })),
    accounts: [...new Set(recent.map((t) => t.account).filter(Boolean))],
  };
}

async function generateInsights({ reason = 'manual' } = {}) {
  const stats = await insightStats();
  const base = { generatedAt: new Date(), reason, stats: { txnCount: stats.txnCount, spent: stats.months[stats.months.length - 1]?.spent || 0 } };
  if (stats.txnCount < 3) {
    const insights = { ...base, summary: 'Not enough transactions yet. Sync your mailbox or add a few expenses and the review will appear here.', alerts: [], tips: [], budgets: [], score: null };
    await Setting.set(INSIGHTS_KEY, insights);
    return insights;
  }
  if (!(await ai.enabled())) throw Object.assign(new Error('Add your OpenAI key under Expenses → Settings to get AI insights'), { status: 400 });
  const system = `You are a sharp, friendly personal-finance coach for a salaried tech lead in India (currency ${stats.currency}; write amounts like ₹1,20,000 with Indian grouping when INR).
Analyse the JSON statistics (monthly totals with per-category breakdown, last-90-day patterns, top and recurring merchants, largest transactions). The current month is partial (dayOfMonth/daysInMonth) — project before comparing.
Return JSON only:
{"summary":"<2-3 sentences: this month vs the user's own average, the single biggest driver>",
 "score":<0-100 spending-health score>,
 "alerts":[{"level":"high|medium|low","title":"<short, specific>","detail":"<1-2 sentences with the actual numbers>"}],
 "tips":["<specific, actionable, numeric where possible>", ...],
 "budgets":[{"category":"<category name>","current":<avg monthly>,"suggested":<number>,"reason":"<short>"}]}
Rules: max 4 alerts, 3-5 tips, 3-6 budgets for the biggest discretionary categories only (skip Rent & EMI, Transfers, Investments & Insurance, Salary & Income). Call out categories rising vs the 3-month average, subscriptions that look duplicated or forgotten, delivery/dining habits, weekend spikes and large one-offs. No generic advice ("track your expenses"), no disclaimers.`;
  const s = await ai.settings();
  const out = await ai.chat({ system, user: JSON.stringify(stats), json: true, maxTokens: 1600 });
  const insights = {
    ...base,
    model: s.model,
    summary: String(out.summary || '').trim(),
    score: Number.isFinite(Number(out.score)) ? Math.max(0, Math.min(100, Math.round(Number(out.score)))) : null,
    alerts: (out.alerts || []).slice(0, 4).map((a) => ({ level: ['high', 'medium', 'low'].includes(a.level) ? a.level : 'medium', title: String(a.title || '').slice(0, 120), detail: String(a.detail || '').slice(0, 400) })),
    tips: (out.tips || []).slice(0, 6).map((t) => String(t).slice(0, 300)),
    budgets: (out.budgets || []).slice(0, 8).map((b) => ({ category: String(b.category || '').slice(0, 40), current: Math.round(Number(b.current) || 0), suggested: Math.round(Number(b.suggested) || 0), reason: String(b.reason || '').slice(0, 160) })),
  };
  await Setting.set(INSIGHTS_KEY, insights);
  return insights;
}

async function getInsights() {
  return (await Setting.get(INSIGHTS_KEY)) || null;
}

// ---------- scheduler hook ----------
async function processExpenses(now) {
  const p = await prefs();
  const m = (await Setting.get(MAIL_KEY)) || {};
  const configured = Boolean(await activeProvider(m));
  // 1) mailbox sync every `syncHours`
  if (configured && p.autoSync !== false && !syncing) {
    const last = m.lastSyncAt ? dayjs(m.lastSyncAt) : null;
    if (!last || now.diff(last, 'hour', true) >= p.syncHours) {
      try {
        const r = await syncMail();
        if (r.added) console.log(`[expenses] mail sync: +${r.added} transaction(s) (${r.fetched} mails)`);
      } catch (e) {
        console.warn('[expenses] mail sync failed:', e.message);
      }
    }
  }
  // 2) daily overspend check (09:00+), once per day
  if (now.hour() >= 9) {
    const todayStr = now.format('YYYY-MM-DD');
    if ((await Setting.get('expense.alertsCheckedOn')) !== todayStr) {
      await Setting.set('expense.alertsCheckedOn', todayStr);
      const r = await checkAlerts(now);
      if (r.notified) console.log(`[expenses] ${r.notified} spending alert(s) raised`);
    }
  }
  // 3) weekly AI review — Monday 09:00+, once per ISO week
  if (p.weeklyReview !== false && now.day() === 1 && now.hour() >= 9 && (await ai.enabled())) {
    const weekKey = now.startOf('week').format('YYYY-MM-DD');
    if ((await Setting.get('expense.weeklyReviewOn')) !== weekKey) {
      await Setting.set('expense.weeklyReviewOn', weekKey);
      try {
        const ins = await generateInsights({ reason: 'weekly' });
        if (ins.summary && ins.stats?.txnCount >= 3) {
          const top = (ins.alerts || []).slice(0, 3).map((a) => `• ${a.title}`).join('\n');
          await notify({ kind: 'expense', title: `Weekly spending review${ins.score !== null ? ` · score ${ins.score}/100` : ''}`, body: [ins.summary, top].filter(Boolean).join('\n'), link: '/expenses' });
        }
      } catch (e) {
        console.warn('[expenses] weekly review failed:', e.message);
      }
    }
  }
}

module.exports = { publicSettings, saveSettings, testMail, syncMail, scanPreview, summary, monthlyTotals, checkAlerts, generateInsights, getInsights, insightStats, processExpenses, prefs, fmtMoney };
