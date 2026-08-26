import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Expenses as Api } from '../lib/api';
import { dayjs, fromNow, toDateInput } from '../lib/date';
import { Empty } from '../components/ui';
import Modal from '../components/Modal';
import Menu from '../components/Menu';
import ExpenseSettings from '../components/ExpenseSettings';
import { useToast } from '../components/Toast';
import { WalletIcon, MailIcon, SparkIcon, PlusIcon, RefreshIcon, SettingsIcon, TrendIcon, ChevronIcon } from '../components/icons';

const CAT = {
  'Food & Dining': ['bg-orange-50 text-orange-700', 'bg-orange-400'],
  Groceries: ['bg-lime-50 text-lime-700', 'bg-lime-500'],
  Shopping: ['bg-pink-50 text-pink-700', 'bg-pink-400'],
  Transport: ['bg-sky-50 text-sky-700', 'bg-sky-400'],
  Fuel: ['bg-amber-50 text-amber-700', 'bg-amber-400'],
  Travel: ['bg-cyan-50 text-cyan-700', 'bg-cyan-400'],
  'Bills & Utilities': ['bg-slate-100 text-slate-700', 'bg-slate-400'],
  Subscriptions: ['bg-violet-50 text-violet-700', 'bg-violet-400'],
  'Rent & EMI': ['bg-stone-100 text-stone-700', 'bg-stone-400'],
  Health: ['bg-rose-50 text-rose-700', 'bg-rose-400'],
  Education: ['bg-indigo-50 text-indigo-700', 'bg-indigo-400'],
  Entertainment: ['bg-fuchsia-50 text-fuchsia-700', 'bg-fuchsia-400'],
  'Personal Care': ['bg-purple-50 text-purple-700', 'bg-purple-400'],
  'Gifts & Donations': ['bg-red-50 text-red-700', 'bg-red-400'],
  'Investments & Insurance': ['bg-teal-50 text-teal-700', 'bg-teal-400'],
  Transfers: ['bg-slate-100 text-slate-600', 'bg-slate-300'],
  Cash: ['bg-yellow-50 text-yellow-700', 'bg-yellow-400'],
  'Fees & Charges': ['bg-red-50 text-red-600', 'bg-red-300'],
  'Salary & Income': ['bg-emerald-50 text-emerald-700', 'bg-emerald-400'],
  Refunds: ['bg-emerald-50 text-emerald-700', 'bg-emerald-300'],
  Other: ['bg-slate-100 text-slate-500', 'bg-slate-300'],
};
const catStyle = (c) => (CAT[c] || CAT.Other)[0];
const catBar = (c) => (CAT[c] || CAT.Other)[1];
const METHODS = ['', 'UPI', 'Credit Card', 'Debit Card', 'Card', 'Net Banking', 'NEFT', 'IMPS', 'RTGS', 'ATM', 'Cash', 'Auto-debit', 'Wallet'];

export const money = (n, cur = 'INR', dec = false) => {
  const v = Number(n) || 0;
  const opts = dec && !Number.isInteger(v) ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 };
  const s = Math.abs(v).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', opts);
  return cur === 'INR' ? `₹${s}` : `${cur} ${s}`;
};

const CatBadge = ({ category, className = '' }) => <span className={`badge ${catStyle(category)} ${className}`}>{category}</span>;

function Stat({ label, value, sub, tone = 'text-slate-900', icon, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`card flex items-start justify-between gap-2 p-4 text-left ${onClick ? 'transition hover:-translate-y-px hover:shadow-lift' : ''}`}>
      <span className="min-w-0">
        <span className={`block text-xl font-bold tabular-nums leading-none tracking-tight ${tone}`}>{value}</span>
        <span className="mt-1.5 block text-xs font-medium text-slate-500">{label}</span>
        {sub && <span className="mt-0.5 block text-xs text-slate-400">{sub}</span>}
      </span>
      {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600">{icon}</span>}
    </Tag>
  );
}

const blankForm = () => ({ type: 'debit', amount: '', date: toDateInput(new Date()), merchant: '', category: 'Other', account: '', method: '', notes: '', excluded: false });

export default function Expenses() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const month = params.get('month') || dayjs().format('YYYY-MM');
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState(null);
  const [meta, setMeta] = useState({ categories: Object.keys(CAT), accounts: [], merchants: [] });
  const [settings, setSettings] = useState(null);
  const [insights, setInsights] = useState(null);
  const [filter, setFilter] = useState({ type: '', category: '', q: '' });
  const [form, setForm] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const setMonth = (m) => {
    const next = new URLSearchParams(params);
    if (m === dayjs().format('YYYY-MM')) next.delete('month');
    else next.set('month', m);
    setParams(next, { replace: true });
  };

  const load = async () => {
    try {
      const [s, l] = await Promise.all([Api.summary(month), Api.list({ month, includeExcluded: true, limit: 1000 })]);
      setSummary(s);
      setList(l);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };
  const loadSide = () => {
    Api.settings().then(setSettings).catch(() => {});
    Api.insights().then(setInsights).catch(() => {});
    Api.meta().then(setMeta).catch(() => {});
  };
  useEffect(() => {
    load();
  }, [month]);
  useEffect(() => {
    loadSide();
  }, []);
  useEffect(() => {
    if (params.get('new')) {
      setForm(blankForm());
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
    if (params.get('settings')) {
      setShowSettings(true);
      const next = new URLSearchParams(params);
      next.delete('settings');
      setParams(next, { replace: true });
    }
    if (params.get('gmail')) {
      // back from Google's consent screen
      if (params.get('gmail') === 'connected') {
        toast.success('Gmail connected', `${params.get('email') || ''} — reading bank alerts now…`);
        loadSide();
        setTimeout(() => sync(false), 300);
      } else toast.error('Gmail not connected', params.get('message') || '');
      const next = new URLSearchParams(params);
      ['gmail', 'email', 'message'].forEach((k) => next.delete(k));
      setParams(next, { replace: true });
    }
  }, [params]);

  const sync = async (full = false) => {
    setSyncing(true);
    try {
      const r = await Api.sync(full ? { full: true, days: 90 } : {});
      toast.success(
        r.added ? `${r.added} new transaction${r.added === 1 ? '' : 's'} added` : 'Mailbox up to date',
        `${r.fetched} alert mail${r.fetched === 1 ? '' : 's'} read · ${r.duplicates} already known · ${r.ignored} not transactions${r.ai ? ` · ${r.ai} parsed by AI` : ''}`
      );
      load();
      loadSide();
    } catch (e) {
      toast.error('Mailbox sync failed', e.message);
      loadSide();
    } finally {
      setSyncing(false);
    }
  };
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const openPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await Api.scanPreview(30));
    } catch (e) {
      toast.error('Scan failed', e.message);
    } finally {
      setPreviewing(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await Api.generateInsights();
      setInsights((i) => ({ ...(i || {}), insights: r, aiEnabled: true }));
      toast.success('Insights updated');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    const payload = { ...form, amount: Number(form.amount) };
    if (!(payload.amount > 0)) return toast.error('Enter an amount');
    try {
      if (form._id) await Api.update(form._id, payload);
      else await Api.create(payload);
      toast.success(form._id ? 'Expense updated' : 'Expense added', `${money(payload.amount, summary?.currency, true)} · ${payload.merchant || payload.category}`);
      setForm(null);
      load();
      Api.meta().then(setMeta).catch(() => {});
    } catch (e) {
      toast.error(e.message);
    }
  };
  const edit = (t) => setForm({ _id: t._id, type: t.type, amount: t.amount, date: toDateInput(t.date), merchant: t.merchant, category: t.category, account: t.account, method: t.method, notes: t.notes || '', excluded: Boolean(t.excluded) });
  const remove = async (t) => {
    if (!window.confirm(`Delete ${money(t.amount, t.currency, true)} ${t.merchant ? `at ${t.merchant}` : ''}?`)) return;
    await Api.remove(t._id);
    load();
  };
  const toggleExclude = async (t) => {
    await Api.update(t._id, { excluded: !t.excluded });
    load();
  };
  const setCategory = async (t, category) => {
    const r = await Api.update(t._id, { category });
    if (r.learned) toast.success(`${category} remembered for ${t.merchant}`, `${r.learned} other transaction${r.learned === 1 ? '' : 's'} of this merchant updated too`);
    load();
  };

  const visible = useMemo(() => {
    if (!list) return [];
    const q = filter.q.trim().toLowerCase();
    return list.filter(
      (t) =>
        (!filter.type || t.type === filter.type) &&
        (!filter.category || t.category === filter.category) &&
        (!q || [t.merchant, t.description, t.account, t.category, t.notes, t.method].some((v) => (v || '').toLowerCase().includes(q)))
    );
  }, [list, filter]);

  const cur = summary?.currency || 'INR';
  const mailReady = settings?.mail?.configured;
  const isNow = month === dayjs().format('YYYY-MM');
  const nothingYet = list && list.length === 0 && settings && !mailReady && !summary?.trend?.some((m) => m.count > 0);
  const ins = insights?.insights;
  const ruleAlerts = insights?.ruleAlerts || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Expenses</h1>
          <div className="sub">Bank and card alerts from your mailbox plus anything you add — one view of where the money goes.</div>
        </div>
        <div className="page-actions">
          <div className="segmented">
            <button onClick={() => setMonth(dayjs(`${month}-01`).subtract(1, 'month').format('YYYY-MM'))} aria-label="Previous month">
              <ChevronIcon size={16} className="rotate-180" />
            </button>
            <button className="active !min-w-[120px]" onClick={() => setMonth(dayjs().format('YYYY-MM'))} title="Jump to this month">
              {dayjs(`${month}-01`).format('MMM YYYY')}
            </button>
            <button onClick={() => setMonth(dayjs(`${month}-01`).add(1, 'month').format('YYYY-MM'))} disabled={isNow} aria-label="Next month">
              <ChevronIcon size={16} />
            </button>
          </div>
          {mailReady ? (
            <button className="btn" onClick={() => sync(false)} disabled={syncing} title="Read new bank alerts from your mailbox now">
              <RefreshIcon size={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Reading mail…' : 'Sync mailbox'}
            </button>
          ) : (
            <button className="btn" onClick={() => setShowSettings(true)}>
              <MailIcon size={16} /> Connect Gmail
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setForm(blankForm())}>
            <PlusIcon size={16} /> Add expense
          </button>
          <Menu
            label="More"
            items={[
              { icon: <SettingsIcon size={16} />, label: 'Settings (mailbox, AI, alerts)', onClick: () => setShowSettings(true) },
              { icon: <SparkIcon size={16} />, label: 'Regenerate AI insights', onClick: generate },
              ...(mailReady ? [{ icon: <MailIcon size={16} />, label: 'Full re-scan (last 90 days)', onClick: () => sync(true) }] : []),
            ]}
          />
        </div>
      </div>

      {error && <div className="card mb border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {nothingYet && (
        <div className="card mb p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-glow">
              <WalletIcon size={24} />
            </span>
            <div className="grow">
              <div className="text-[15px] font-semibold text-slate-900">Set up your expense manager</div>
              <div className="mt-0.5 text-[13px] text-slate-500">
                1. Connect the mailbox that receives your bank / card / UPI alerts (read-only, app password). 2. Add your OpenAI key for accurate parsing and a weekly review. Or just start adding expenses by hand.
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn btn-primary" onClick={() => setShowSettings(true)}>
                <MailIcon size={16} /> Connect mailbox
              </button>
              <button className="btn" onClick={() => setForm(blankForm())}>
                Add manually
              </button>
            </div>
          </div>
        </div>
      )}

      {summary && (
        <div className="mb grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Spent" value={money(summary.spent, cur)} tone="text-slate-900" icon={<WalletIcon size={18} />} sub={summary.vsPrevPct !== null ? `${summary.vsPrevPct > 0 ? '+' : ''}${summary.vsPrevPct}% vs last month` : summary.prevSpent ? '' : 'no data last month'} />
          <Stat label="Received" value={money(summary.income, cur)} tone="text-emerald-600" />
          <Stat label="Net" value={`${summary.net < 0 ? '−' : ''}${money(summary.net, cur)}`} tone={summary.net < 0 ? 'text-red-600' : 'text-emerald-600'} />
          <Stat label="Daily average" value={money(summary.dailyAvg, cur)} sub={summary.avgSpent ? `3-mo avg ${money(summary.avgSpent / dayjs(`${month}-01`).daysInMonth(), cur)}/day` : ''} />
          <Stat label={summary.isCurrent ? 'Projected this month' : 'Last month'} value={money(summary.isCurrent ? summary.projected : summary.prevSpent, cur)} tone={summary.isCurrent && summary.vsAvgPct > 15 ? 'text-amber-600' : 'text-slate-900'} sub={summary.isCurrent && summary.vsAvgPct !== null ? `${summary.vsAvgPct > 0 ? '+' : ''}${summary.vsAvgPct}% vs your average` : ''} />
          <Stat label="Transactions" value={summary.included} sub={`${summary.fromEmail} from mail${summary.uncategorized ? ` · ${summary.uncategorized} uncategorised` : ''}`} onClick={() => setFilter({ type: '', category: summary.uncategorized ? 'Other' : '', q: '' })} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {summary && summary.byCategory.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3>
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-50 text-primary-600">
                    <TrendIcon size={16} />
                  </span>
                  Where it went
                </h3>
                {filter.category && (
                  <button className="btn btn-xs btn-ghost" onClick={() => setFilter({ ...filter, category: '' })}>
                    Clear filter ✕
                  </button>
                )}
              </div>
              <div className="card-body tight">
                <ul className="grid gap-2 md:grid-cols-2">
                  {summary.byCategory.slice(0, 12).map((c) => (
                    <li key={c.category} className={`cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50 ${filter.category === c.category ? 'bg-primary-50' : ''}`} onClick={() => setFilter({ ...filter, category: filter.category === c.category ? '' : c.category })}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${catBar(c.category)}`} />
                          <span className="truncate font-medium text-slate-800">{c.category}</span>
                          <span className="text-xs text-slate-400">{c.count}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">
                          <b className="text-slate-900">{money(c.total, cur)}</b> <span className="text-xs text-slate-400">{c.pct}%</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${catBar(c.category)}`} style={{ width: `${Math.max(2, (c.total / summary.byCategory[0].total) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head flex-wrap gap-2">
              <h3>Transactions</h3>
              <div className="flex flex-wrap items-center gap-2">
                <div className="segmented">
                  {[
                    ['', 'All'],
                    ['debit', 'Spent'],
                    ['credit', 'Received'],
                  ].map(([v, l]) => (
                    <button key={v} className={filter.type === v ? 'active' : ''} onClick={() => setFilter({ ...filter, type: v })}>
                      {l}
                    </button>
                  ))}
                </div>
                <select className="select input-sm w-180" value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
                  <option value="">All categories</option>
                  {meta.categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input className="input input-sm w-180" type="search" placeholder="Search…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
              </div>
            </div>
            {list && list.length === 0 && <Empty icon="💳" text={`No transactions in ${dayjs(`${month}-01`).format('MMMM')}.`} />}
            {list && list.length > 0 && visible.length === 0 && <Empty icon="🔍" text="Nothing matches these filters." />}
            {visible.length > 0 && (
              <ul className="list">
                {visible.map((t) => (
                  <li key={t._id} className={`lrow group ${t.excluded ? 'opacity-50' : ''}`}>
                    <div className="hidden w-14 shrink-0 text-xs leading-tight text-slate-500 md:block">
                      <div className="font-semibold text-slate-700">{dayjs(t.date).format('DD MMM')}</div>
                      <div>{dayjs(t.date).format('ddd')}</div>
                    </div>
                    <div className="min-w-0 grow">
                      <div className="flex items-center gap-2">
                        <span className={`title truncate ${t.excluded ? 'line-through' : ''}`}>{t.merchant || t.description || 'Unknown'}</span>
                        {t.source === 'email' && (
                          <span className="shrink-0 text-slate-400" title={`From e-mail: ${t.email?.subject || ''}`}>
                            <MailIcon size={13} />
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                        <span className="md:hidden">{dayjs(t.date).format('DD MMM')} ·</span>
                        <select className={`badge cursor-pointer appearance-none border-0 pr-1 ${catStyle(t.category)}`} value={t.category} onChange={(e) => setCategory(t, e.target.value)} title="Change category" onClick={(e) => e.stopPropagation()}>
                          {meta.categories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        {t.account && <span>· {t.account}</span>}
                        {t.method && <span>· {t.method}</span>}
                        {t.excluded && <span className="text-slate-400">· excluded from totals</span>}
                        {t.notes && <span className="truncate text-slate-400">· {t.notes}</span>}
                      </div>
                    </div>
                    <div className={`shrink-0 text-right text-sm font-semibold tabular-nums ${t.type === 'credit' ? 'text-emerald-600' : 'text-slate-900'}`}>
                      {t.type === 'credit' ? '+' : '−'}
                      {money(t.amount, t.currency || cur, true)}
                    </div>
                    <Menu
                      items={[
                        { label: 'Edit', onClick: () => edit(t) },
                        { label: t.excluded ? 'Include in totals' : 'Exclude from totals', onClick: () => toggleExclude(t) },
                        { label: 'Delete', danger: true, onClick: () => remove(t) },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="card">
            <div className="card-head">
              <h3>
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-600">
                  <SparkIcon size={16} />
                </span>
                AI insights
              </h3>
              {ins?.generatedAt && <span className="text-xs text-slate-400">{fromNow(ins.generatedAt)}</span>}
            </div>
            <div className="card-body">
              {ruleAlerts.length > 0 && (
                <ul className="mb-3 flex flex-col gap-2">
                  {ruleAlerts.map((a) => (
                    <li key={a.key} className={`rounded-lg border-l-4 px-3 py-2 text-[13px] ${a.level === 'high' ? 'border-red-400 bg-red-50' : a.level === 'medium' ? 'border-amber-400 bg-amber-50' : 'border-sky-300 bg-sky-50'}`}>
                      <b className="text-slate-900">{a.title}</b>
                      <div className="text-slate-600">{a.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
              {insights && !insights.aiEnabled && (
                <div className="text-[13px] text-slate-500">
                  Add your OpenAI key to get a written review of your spending — what is rising, what to trim, and suggested budgets per category.
                  <div className="mt-2">
                    <button className="btn btn-sm" onClick={() => setShowSettings(true)}>
                      Add OpenAI key
                    </button>
                  </div>
                </div>
              )}
              {insights?.aiEnabled && !ins && (
                <div className="text-[13px] text-slate-500">
                  No review yet.
                  <div className="mt-2">
                    <button className="btn btn-sm btn-primary" onClick={generate} disabled={generating}>
                      {generating ? 'Thinking…' : 'Generate insights'}
                    </button>
                  </div>
                </div>
              )}
              {ins && (
                <>
                  {ins.score !== null && ins.score !== undefined && (
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`badge ${ins.score >= 70 ? 'badge-done' : ins.score >= 40 ? 'badge-soon' : 'badge-overdue'}`}>Spending health {ins.score}/100</span>
                    </div>
                  )}
                  <p className="text-sm leading-relaxed text-slate-700">{ins.summary}</p>
                  {ins.alerts?.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2">
                      {ins.alerts.map((a, i) => (
                        <li key={i} className={`rounded-lg border-l-4 px-3 py-2 text-[13px] ${a.level === 'high' ? 'border-red-400 bg-red-50' : a.level === 'medium' ? 'border-amber-400 bg-amber-50' : 'border-sky-300 bg-sky-50'}`}>
                          <b className="text-slate-900">{a.title}</b>
                          <div className="text-slate-600">{a.detail}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {ins.tips?.length > 0 && (
                    <div className="mt-3">
                      <div className="section-title">How to control it</div>
                      <ul className="flex flex-col gap-1.5 text-[13px] text-slate-700">
                        {ins.tips.map((t, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-primary-500">→</span>
                            <span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {ins.budgets?.length > 0 && (
                    <div className="mt-3">
                      <div className="section-title">Suggested monthly budgets</div>
                      <ul className="flex flex-col gap-1 text-[13px]">
                        {ins.budgets.map((b, i) => (
                          <li key={i} className="flex items-center justify-between gap-2" title={b.reason}>
                            <span className="truncate text-slate-700">{b.category}</span>
                            <span className="shrink-0 tabular-nums">
                              <span className="text-slate-400 line-through">{money(b.current, cur)}</span> <b className="text-slate-900">{money(b.suggested, cur)}</b>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3">
                    <button className="btn btn-xs btn-ghost" onClick={generate} disabled={generating}>
                      <RefreshIcon size={13} className={generating ? 'animate-spin' : ''} /> {generating ? 'Thinking…' : 'Refresh'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {summary && summary.trend.some((m) => m.count > 0) && (
            <div className="card">
              <div className="card-head">
                <h3>Last 6 months</h3>
                <span className="text-xs text-slate-400">spent</span>
              </div>
              <div className="card-body">
                <div className="flex h-28 items-end gap-2">
                  {summary.trend.map((m) => {
                    const max = Math.max(...summary.trend.map((x) => x.debit), 1);
                    const sel = m.month === month;
                    return (
                      <button key={m.month} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" onClick={() => setMonth(m.month)} title={`${m.label}: ${money(m.debit, cur)} spent, ${money(m.credit, cur)} received`}>
                        <span className="text-[10px] tabular-nums text-slate-400 opacity-0 transition group-hover:opacity-100">{m.debit ? money(m.debit, cur) : ''}</span>
                        <span className={`w-full rounded-t-md transition ${sel ? 'bg-brand' : 'bg-primary-200 group-hover:bg-primary-300'}`} style={{ height: `${Math.max(3, (m.debit / max) * 80)}%` }} />
                        <span className={`text-[11px] ${sel ? 'font-semibold text-primary-600' : 'text-slate-500'}`}>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {summary && summary.topMerchants.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3>Top merchants</h3>
              </div>
              <ul className="list">
                {summary.topMerchants.slice(0, 6).map((m) => (
                  <li key={m.merchant} className="lrow cursor-pointer" onClick={() => setFilter({ ...filter, q: m.merchant })}>
                    <div className="min-w-0 grow">
                      <div className="title truncate">{m.merchant}</div>
                      <div className="meta">
                        {m.count} × · {m.category}
                      </div>
                    </div>
                    <b className="shrink-0 text-sm tabular-nums text-slate-900">{money(m.total, cur)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h3>
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50 text-sky-600">
                  <MailIcon size={16} />
                </span>
                Mailbox
              </h3>
              <button className="btn btn-xs btn-ghost" onClick={() => setShowSettings(true)}>
                <SettingsIcon size={13} /> Settings
              </button>
            </div>
            <div className="card-body text-[13px] text-slate-600">
              {!settings && 'Loading…'}
              {settings && !mailReady && (
                <>
                  Not connected. Sign in with Google (read-only Gmail access) and WorkPA will pull your bank / card / UPI alerts every {settings.prefs?.syncHours || 6} hours.
                  <div className="mt-2">
                    <button className="btn btn-sm btn-primary" onClick={() => setShowSettings(true)}>
                      Connect Gmail
                    </button>
                  </div>
                </>
              )}
              {settings && mailReady && (
                <>
                  <div>
                    {settings.mail.provider === 'gmail' ? (
                      <>
                        <b className="text-slate-900">{settings.gmail?.email}</b> · Gmail (Google sign-in)
                      </>
                    ) : (
                      <>
                        <b className="text-slate-900">{settings.mail.user}</b> · {settings.mail.folder} (IMAP)
                      </>
                    )}
                  </div>
                  <div className="mt-1 text-slate-500">{settings.mail.lastSyncAt ? `Last checked ${fromNow(settings.mail.lastSyncAt)}` : 'Never synced yet'}{settings.mail.lastResult ? ` · +${settings.mail.lastResult.added} added, ${settings.mail.lastResult.fetched} mails read` : ''}</div>
                  {settings.mail.lastError && <div className="mt-1 text-red-600">✕ {settings.mail.lastError}</div>}
                  <div className="mt-1 text-slate-500">
                    AI parsing: {settings.ai?.hasKey ? <span className="text-emerald-600">on ({settings.ai.model})</span> : <span className="text-amber-600">off — rules only</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className="btn btn-sm" onClick={() => sync(false)} disabled={syncing}>
                      {syncing ? 'Reading…' : 'Sync now'}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={openPreview} disabled={previewing} title="Lists the mails the scan looked at and what the parser made of each">
                      {previewing ? 'Scanning…' : 'What did the scan find?'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {form && (
        <Modal
          title={form._id ? 'Edit expense' : 'Add expense'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={!(Number(form.amount) > 0)}>
                {form._id ? 'Save changes' : 'Add expense'}
              </button>
            </>
          }
        >
          <div className="segmented mb-3">
            <button className={form.type === 'debit' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'debit' })}>
              Spent
            </button>
            <button className={form.type === 'credit' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'credit' })}>
              Received
            </button>
          </div>
          <div className="form-grid">
            <label className="field">
              Amount ({cur})
              <input className="input" type="number" inputMode="decimal" min="0" step="0.01" autoFocus value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </label>
            <label className="field">
              Date
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="field">
              {form.type === 'credit' ? 'From' : 'Paid to'}
              <input className="input" list="exp-merchants" value={form.merchant} onChange={(e) => {
                const m = meta.merchants.find((x) => x.merchant === e.target.value);
                setForm({ ...form, merchant: e.target.value, ...(m && form.category === 'Other' ? { category: m.category } : {}) });
              }} placeholder="e.g. Swiggy, Airtel, landlord" />
              <datalist id="exp-merchants">
                {meta.merchants.map((m) => (
                  <option key={m.merchant} value={m.merchant} />
                ))}
              </datalist>
            </label>
            <label className="field">
              Category
              <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {meta.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Account (optional)
              <input className="input" list="exp-accounts" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder="e.g. HDFC ••1234" />
              <datalist id="exp-accounts">
                {meta.accounts.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
            <label className="field">
              Method (optional)
              <select className="select" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m || '—'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            Notes (optional)
            <textarea className="textarea" style={{ minHeight: 60 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <label className="checkbox text-sm">
            <input type="checkbox" checked={form.excluded} onChange={(e) => setForm({ ...form, excluded: e.target.checked })} /> Exclude from totals (e.g. transfer to my own account)
          </label>
        </Modal>
      )}

      {preview && (
        <Modal title={`Mailbox scan — last ${preview.days} days`} wide onClose={() => setPreview(null)} footer={<button className="btn" onClick={() => setPreview(null)}>Close</button>}>
          <div className="mb-3 text-[13px] text-slate-600">
            Google returned <b>{preview.scanned}</b> mail{preview.scanned === 1 ? '' : 's'} for the bank/payment search; <b>{preview.downloaded}</b> downloaded, <b>{preview.items.filter((i) => i.txn).length}</b> read as transactions by the rule parser
            {preview.items.filter((i) => i.imported).length > 0 && <> · {preview.items.filter((i) => i.imported).length} already imported</>}. If your bank alerts are missing here, they are not reaching this Gmail inbox (or land in Spam) — check the bank's e-mail alert settings.
          </div>
          {preview.items.length === 0 && <Empty icon="📭" text="No candidate mails at all in this period." />}
          <ul className="list">
            {preview.items.map((it, i) => (
              <li key={i} className="lrow items-start">
                <div className="w-14 shrink-0 text-xs text-slate-500">{dayjs(it.date).format('DD MMM')}</div>
                <div className="min-w-0 grow">
                  <div className="truncate text-sm font-medium text-slate-900">{it.subject || '(no subject)'}</div>
                  <div className="truncate text-xs text-slate-500">{it.from}</div>
                  {!it.txn && <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">{it.snippet}</div>}
                </div>
                <div className="shrink-0 text-right text-xs">
                  {it.txn ? (
                    <>
                      <div className={`text-sm font-semibold tabular-nums ${it.txn.type === 'credit' ? 'text-emerald-600' : 'text-slate-900'}`}>
                        {it.txn.type === 'credit' ? '+' : '−'}
                        {money(it.txn.amount, cur, true)}
                      </div>
                      <div className="text-slate-500">
                        {it.txn.merchant} · {it.txn.category}
                      </div>
                      {it.imported && <span className="badge badge-done mt-1">imported</span>}
                    </>
                  ) : (
                    <span className="badge badge-outline">not a transaction</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {showSettings && <ExpenseSettings settings={settings} onClose={() => setShowSettings(false)} onSaved={(s) => { setSettings(s); Api.insights().then(setInsights).catch(() => {}); }} />}
    </>
  );
}
