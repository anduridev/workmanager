import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zendesk as Api } from '../../lib/api';
import { dayjs, fmtDateTime } from '../../lib/date';
import { Empty } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { RefreshIcon } from '../../components/icons';
import { STATUS_LABEL, STATUS_CLS, PRIORITY_CLS, METRIC_LABEL, minsLabel, SlaChip, useZendesk, ConnLine, NotConfigured } from './lib';

const Tile = ({ label, value, tone = '' }) => (
  <div className="card !p-4">
    <div className="text-[12px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
    <div className={`mt-1 text-2xl font-bold ${tone || 'text-slate-900'}`}>{value}</div>
  </div>
);

export default function Report() {
  const { status, ready, orgs, orgName } = useZendesk();
  const [org, setOrg] = useState(localStorage.getItem('workpa_zd_report_org') || '');
  const [tickets, setTickets] = useState(null);
  const [sla, setSla] = useState(null);
  const [busy, setBusy] = useState(false);
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
  const openBySla = useMemo(() => [...open].sort((a, b) => (a.sla?.breachAt ? new Date(a.sla.breachAt) : Infinity) - (b.sla?.breachAt ? new Date(b.sla.breachAt) : Infinity)), [open]);

  if (status && !status.enabled) return <NotConfigured title="Zendesk · SLA Report" />;

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
            <Tile label="Open tickets" value={sla.live.open} />
            <Tile label="Tracked by SLA" value={sla.live.withSla} />
            <Tile label="Breached" value={sla.live.breached.length} tone={sla.live.breached.length ? 'text-red-600' : 'text-emerald-600'} />
            <Tile label="At risk (<4h)" value={sla.live.atRisk.length} tone={sla.live.atRisk.length ? 'text-amber-600' : 'text-emerald-600'} />
            <Tile label="Solved, last 30d" value={solved30} />
          </div>

          <div className="card">
            <div className="row wrap items-center gap-2">
              <b className="text-[14px]">Status mix — {org ? orgName(org) : 'all clients'}</b>
              {Object.entries(byStatus).map(([s, n]) => (
                <span key={s} className={`badge ${STATUS_CLS[s] || ''}`}>
                  {STATUS_LABEL[s] || s}: {n}
                </span>
              ))}
              {!tickets?.length && <span className="muted text-[13px]">No tickets found.</span>}
            </div>
          </div>

          {(sla.live.breached.length > 0 || sla.live.atRisk.length > 0) && (
            <div className="card">
              <b className="text-[14px]">Needs attention now</b>
              <div className="mt-2 flex flex-col gap-1 text-[13px]">
                {[...sla.live.breached.map((t) => ({ ...t, breached: true })), ...sla.live.atRisk].map((t) => (
                  <div key={`${t.id}-${t.metric}`} className="row items-center gap-2">
                    <span className={`badge ${t.breached ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800'}`}>
                      {t.breached ? 'Breached' : `${minsLabel(Math.max(0, dayjs(t.breachAt).diff(dayjs(), 'minute')))} left`}
                    </span>
                    <span className="muted">#{t.id}</span>
                    <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                    <span className="muted whitespace-nowrap">({METRIC_LABEL[t.metric] || t.metric})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ overflowX: 'auto' }}>
            <b className="text-[14px]">Open tickets by SLA deadline</b>
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
                  {openBySla.map((t) => (
                    <tr key={t.id}>
                      <td className="muted">{t.id}</td>
                      <td>
                        <a className="font-medium hover:text-primary-600" href={t.url} target="_blank" rel="noreferrer">
                          {t.subject}
                        </a>
                      </td>
                      {!org && <td className="muted">{t.organizationId ? orgName(t.organizationId) || '—' : '—'}</td>}
                      <td className={`capitalize ${PRIORITY_CLS[t.priority] || 'text-slate-400'}`}>{t.priority || '—'}</td>
                      <td>
                        <span className={`badge ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                      </td>
                      <td className="muted">{t.assignee?.name || '—'}</td>
                      <td>
                        <SlaChip sla={t.sla} />
                        {t.sla?.breachAt && <div className="muted mt-0.5 text-[11px]">{fmtDateTime(t.sla.breachAt)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <b className="text-[14px]">SLA policies that apply{org ? ` to ${orgName(org)}` : ''}</b>
            {sla.policies.length === 0 && <div className="muted mt-1 text-[13px]">None.</div>}
            <div className="mt-2 flex flex-col gap-1 text-[13px]">
              {sla.policies.map((p) => (
                <div key={p.id} className="row wrap items-center gap-2">
                  <b>{p.title}</b>
                  {p.metrics.slice(0, 4).map((m, j) => (
                    <span key={j} className="badge bg-slate-100 text-slate-600">
                      {m.priority}: {(METRIC_LABEL[m.metric] || m.metric).toLowerCase()} ≤ {minsLabel(m.targetMinutes)}
                    </span>
                  ))}
                  {p.metrics.length > 4 && <span className="muted text-[12px]">+{p.metrics.length - 4} more</span>}
                </div>
              ))}
            </div>
            <p className="muted mt-2 text-[12px]">Full details with explanations are on the SLA Policies screen.</p>
          </div>
        </div>
      )}
    </>
  );
}
