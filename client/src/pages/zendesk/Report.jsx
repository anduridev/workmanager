import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zendesk as Api } from '../../lib/api';
import { dayjs, fmtDate } from '../../lib/date';
import { Empty } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { RefreshIcon } from '../../components/icons';
import { STATUS_LABEL, STATUS_CLS, PRIORITY_CLS, PRIORITY_DOT, METRIC_LABEL, minsLabel, useZendesk, ConnLine, NotConfigured } from './lib';

/** "74d" / "3h 20m" for a duration in minutes. */
const durLabel = (mins) => (mins >= 2880 ? `${Math.round(mins / 1440)}d` : minsLabel(Math.max(1, Math.round(mins))));

const Bar = ({ label, n, max, cls = 'bg-primary-500' }) => (
  <div className="row items-center gap-2 text-[13px]">
    <span className="w-24 shrink-0 truncate capitalize text-slate-500">{label}</span>
    <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${max ? Math.max(4, (n / max) * 100) : 0}%` }} />
    </div>
    <b className="w-7 shrink-0 text-right tabular-nums">{n}</b>
  </div>
);

const Tile = ({ icon, label, value, tone = 'text-slate-900', ring = 'bg-slate-100' }) => (
  <div className="card row items-center gap-3 !p-4">
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${ring}`}>{icon}</span>
    <span className="min-w-0">
      <span className={`block text-xl font-bold leading-tight tabular-nums ${tone}`}>{value}</span>
      <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
    </span>
  </div>
);

/** SLA cell for the deadline table: overdue duration or time left, with metric + date beneath. */
function DeadlineCell({ sla }) {
  if (!sla?.breachAt) return <span className="text-slate-300">—</span>;
  const mins = dayjs(sla.breachAt).diff(dayjs(), 'minute');
  const metric = METRIC_LABEL[sla.metric] || sla.metric;
  return (
    <div>
      {mins < 0 ? (
        <span className="badge bg-red-600 text-white">Overdue {durLabel(-mins)}</span>
      ) : (
        <span className={`badge ${mins < 240 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>in {durLabel(mins)}</span>
      )}
      <div className="muted mt-0.5 text-[11px]">
        {metric} · {fmtDate(sla.breachAt, 'DD MMM')}
      </div>
    </div>
  );
}

export default function Report() {
  const { status, ready, orgs, orgName } = useZendesk();
  const [org, setOrg] = useState(localStorage.getItem('workpa_zd_report_org') || '');
  const [tickets, setTickets] = useState(null);
  const [sla, setSla] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const toast = useToast();

  useEffect(() => {
    localStorage.setItem('workpa_zd_report_org', org);
  }, [org]);

  const load = useCallback(async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const [list, s] = await Promise.all([Api.tickets({ org: org || undefined }), Api.sla(org || undefined)]);
      setTickets(list);
      setSla(s);
      setShowAllRows(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }, [ready, org]);
  useEffect(() => {
    load();
  }, [load]);

  const open = useMemo(() => (tickets || []).filter((t) => !['solved', 'closed'].includes(t.status)), [tickets]);
  const byStatus = useMemo(() => {
    const m = {};
    (tickets || []).forEach((t) => (m[t.status] = (m[t.status] || 0) + 1));
    return m;
  }, [tickets]);
  const solved30 = useMemo(() => (tickets || []).filter((t) => ['solved', 'closed'].includes(t.status) && dayjs(t.updatedAt).isAfter(dayjs().subtract(30, 'day'))).length, [tickets]);
  const unassigned = useMemo(() => open.filter((t) => !t.assignee).length, [open]);
  const aging = useMemo(() => {
    const b = [['< 1 day', 0], ['1–3 days', 0], ['3–7 days', 0], ['> 7 days', 0]];
    open.forEach((t) => {
      const h = dayjs().diff(dayjs(t.createdAt), 'hour');
      b[h < 24 ? 0 : h < 72 ? 1 : h < 168 ? 2 : 3][1]++;
    });
    return b;
  }, [open]);
  const byAssignee = useMemo(() => {
    const m = {};
    open.forEach((t) => {
      const k = t.assignee?.name || 'Unassigned';
      m[k] = (m[k] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [open]);
  const byPriority = useMemo(() => {
    const m = {};
    open.forEach((t) => {
      const k = t.priority || 'none';
      m[k] = (m[k] || 0) + 1;
    });
    return ['urgent', 'high', 'normal', 'low', 'none'].filter((k) => m[k]).map((k) => [k, m[k]]);
  }, [open]);
  const openBySla = useMemo(() => [...open].sort((a, b) => (a.sla?.breachAt ? new Date(a.sla.breachAt) : Infinity) - (b.sla?.breachAt ? new Date(b.sla.breachAt) : Infinity)), [open]);

  /** Breaches grouped per metric: "First reply × 20 · oldest overdue 74d". */
  const breachSummary = useMemo(() => {
    if (!sla) return [];
    const m = {};
    sla.live.breached.forEach((t) => {
      const k = METRIC_LABEL[t.metric] || t.metric;
      const overdue = dayjs().diff(dayjs(t.breachAt), 'minute');
      if (!m[k]) m[k] = { n: 0, worst: 0 };
      m[k].n++;
      m[k].worst = Math.max(m[k].worst, overdue);
    });
    return Object.entries(m);
  }, [sla]);

  if (status && !status.enabled) return <NotConfigured title="Zendesk · SLA Report" />;

  const rows = showAllRows ? openBySla : openBySla.slice(0, 12);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>SLA Report</h1>
          <div className="sub">
            <ConnLine status={status} orgs={orgs} />
          </div>
        </div>
        <div className="row wrap">
          <select className="select input-sm w-220" value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">All clients</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={load} disabled={busy} title="Refresh">
            <RefreshIcon /> {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {sla === null && <div className="card"><Empty icon="⏳" text="Building the report…" /></div>}

      {sla !== null && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile icon="🎫" label="Open tickets" value={sla.live.open} ring="bg-primary-50" />
            <Tile icon="⏰" label="SLA breached" value={sla.live.breached.length} tone={sla.live.breached.length ? 'text-red-600' : 'text-emerald-600'} ring={sla.live.breached.length ? 'bg-red-50' : 'bg-emerald-50'} />
            <Tile icon="⚠️" label="At risk (<4h)" value={sla.live.atRisk.length} tone={sla.live.atRisk.length ? 'text-amber-600' : 'text-emerald-600'} ring="bg-amber-50" />
            <Tile icon="👤" label="Unassigned" value={unassigned} tone={unassigned ? 'text-amber-700' : 'text-slate-900'} ring="bg-slate-100" />
            <Tile icon="✅" label="Solved, 30 days" value={solved30} ring="bg-emerald-50" />
          </div>

          {(breachSummary.length > 0 || sla.live.atRisk.length > 0) && (
            <div className="card border-l-4 !border-l-red-500">
              <div className="row wrap items-center gap-x-4 gap-y-2">
                <b className="text-[14px]">SLA health — {org ? orgName(org) : 'all clients'}</b>
                {breachSummary.map(([metric, x]) => (
                  <span key={metric} className="text-[13px]">
                    <span className="badge bg-red-600 text-white">{x.n}</span> <b>{metric}</b> breached <span className="muted">(worst overdue {durLabel(x.worst)})</span>
                  </span>
                ))}
                {sla.live.atRisk.slice(0, 3).map((t) => (
                  <span key={`${t.id}-${t.metric}`} className="text-[13px]">
                    <span className="badge bg-amber-100 text-amber-800">{durLabel(Math.max(0, dayjs(t.breachAt).diff(dayjs(), 'minute')))} left</span> #{t.id} <span className="muted">{t.subject.slice(0, 40)}…</span>
                  </span>
                ))}
              </div>
              <p className="muted mt-1.5 text-[12px]">Every breached and upcoming deadline is listed per ticket in the table below, most urgent first.</p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="card">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Open by assignee</div>
              <div className="flex flex-col gap-1.5">
                {byAssignee.map(([name, n]) => (
                  <Bar key={name} label={name} n={n} max={byAssignee[0][1]} cls={name === 'Unassigned' ? 'bg-slate-400' : 'bg-primary-500'} />
                ))}
                {!open.length && <span className="muted text-[13px]">Nothing open.</span>}
              </div>
            </div>
            <div className="card">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Open by age</div>
              <div className="flex flex-col gap-1.5">
                {aging.map(([label, n], i) => (
                  <Bar key={label} label={label} n={n} max={Math.max(...aging.map((x) => x[1]))} cls={['bg-emerald-400', 'bg-sky-400', 'bg-amber-400', 'bg-red-500'][i]} />
                ))}
              </div>
              <p className="muted mt-2 text-[11px]">Old open tickets are usually the first SLA risk — clear the red bar first.</p>
            </div>
            <div className="card">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Open by priority</div>
              <div className="flex flex-col gap-1.5">
                {byPriority.map(([p, n]) => (
                  <Bar key={p} label={p} n={n} max={byPriority.reduce((mx, x) => Math.max(mx, x[1]), 0)} cls={PRIORITY_DOT[p] || 'bg-slate-300'} />
                ))}
                {!open.length && <span className="muted text-[13px]">Nothing open.</span>}
              </div>
              <div className="row wrap mt-2 gap-1.5">
                {Object.entries(byStatus).map(([s, n]) => (
                  <span key={s} className={`badge ${STATUS_CLS[s] || ''}`}>
                    {STATUS_LABEL[s] || s}: {n}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="row items-center justify-between">
              <b className="text-[14px]">Open tickets by SLA deadline</b>
              <span className="muted text-[12px]">{openBySla.length} open</span>
            </div>
            {openBySla.length === 0 && <div className="mt-2"><Empty icon="✅" text="No open tickets." /></div>}
            {openBySla.length > 0 && (
              <table className="task-table mt-2">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Subject</th>
                    {!org && <th>Client</th>}
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Assignee</th>
                    <th>SLA deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="muted tabular-nums">{t.id}</td>
                      <td>
                        <a className="font-medium hover:text-primary-600" href={t.url} target="_blank" rel="noreferrer">
                          {t.subject}
                        </a>
                        <div className="muted text-[11px]">opened {dayjs(t.createdAt).fromNow()}</div>
                      </td>
                      {!org && <td className="muted whitespace-nowrap">{t.organizationId ? orgName(t.organizationId) || '—' : '—'}</td>}
                      <td>
                        <span className={`inline-flex items-center gap-1.5 capitalize ${PRIORITY_CLS[t.priority] || 'text-slate-400'}`}>
                          <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[t.priority] || 'bg-slate-200'}`} />
                          {t.priority || '—'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                      </td>
                      <td className={t.assignee ? 'muted' : 'text-amber-700'}>{t.assignee?.name || 'Unassigned'}</td>
                      <td>
                        <DeadlineCell sla={t.sla} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {openBySla.length > 12 && (
              <div className="mt-2 text-center">
                <button className="btn btn-xs btn-ghost" onClick={() => setShowAllRows((x) => !x)}>
                  {showAllRows ? 'Show fewer' : `Show all ${openBySla.length} tickets`}
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <b className="text-[14px]">SLA policies that apply{org ? ` to ${orgName(org)}` : ''}</b>
            {sla.policies.length === 0 && <div className="muted mt-1 text-[13px]">None.</div>}
            <div className="mt-2 flex flex-col gap-1 text-[13px]">
              {sla.policies.map((p) => {
                const urgent = p.metrics.filter((m) => m.priority === 'urgent').sort((a, b) => a.targetMinutes - b.targetMinutes)[0];
                const fastest = urgent || [...p.metrics].sort((a, b) => a.targetMinutes - b.targetMinutes)[0];
                return (
                  <div key={p.id} className="row wrap items-center gap-2">
                    <b>{p.title}</b>
                    {fastest && (
                      <span className="badge bg-slate-100 text-slate-600">
                        fastest: {fastest.priority} {(METRIC_LABEL[fastest.metric] || fastest.metric).toLowerCase()} ≤ {minsLabel(fastest.targetMinutes)}
                      </span>
                    )}
                    <span className="muted text-[12px]">{p.metrics.length} targets</span>
                  </div>
                );
              })}
            </div>
            <p className="muted mt-2 text-[12px]">Full target matrices with explanations are on the SLA Policies screen.</p>
          </div>
        </div>
      )}
    </>
  );
}
