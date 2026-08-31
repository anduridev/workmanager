import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zendesk as Api } from '../lib/api';
import { dayjs, fmtDateTime } from '../lib/date';
import { Empty, Segmented } from '../components/ui';
import { useToast } from '../components/Toast';
import { useIsMobile } from '../lib/useMedia';
import { RefreshIcon } from '../components/icons';

const STATUSES = ['new', 'open', 'pending', 'hold', 'solved'];
const STATUS_LABEL = { new: 'New', open: 'Open', pending: 'Pending', hold: 'On hold', solved: 'Solved', closed: 'Closed' };
const STATUS_CLS = {
  new: 'bg-amber-100 text-amber-800',
  open: 'bg-red-100 text-red-700',
  pending: 'bg-sky-100 text-sky-700',
  hold: 'bg-slate-200 text-slate-700',
  solved: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-100 text-slate-500',
};
const PRIORITY_CLS = { urgent: 'text-red-600', high: 'text-amber-600', normal: 'text-slate-500', low: 'text-slate-400' };
const METRIC_LABEL = {
  first_reply_time: 'First reply',
  next_reply_time: 'Next reply',
  periodic_update_time: 'Periodic update',
  pausable_update_time: 'Update',
  requester_wait_time: 'Requester wait',
  agent_work_time: 'Agent work',
  resolution_time: 'Resolution',
};

const minsLabel = (m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

/** SLA countdown chip: red when breached / <1h, amber <4h. */
function SlaChip({ sla }) {
  if (!sla?.breachAt) return <span className="text-slate-300">—</span>;
  const diff = dayjs(sla.breachAt).diff(dayjs(), 'minute');
  const label = METRIC_LABEL[sla.metric] || sla.metric;
  if (diff < 0)
    return (
      <span className="badge bg-red-600 text-white" title={`${label} target breached ${fmtDateTime(sla.breachAt)}`}>
        Breached · {label}
      </span>
    );
  const cls = diff < 60 ? 'bg-red-100 text-red-700' : diff < 240 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  return (
    <span className={`badge ${cls}`} title={`${label} target: ${fmtDateTime(sla.breachAt)}`}>
      {label} in {minsLabel(diff)}
    </span>
  );
}

export default function Zendesk() {
  const [status, setStatus] = useState(null); // connection status
  const [orgs, setOrgs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tickets, setTickets] = useState(null);
  const [sla, setSla] = useState(null);
  const [org, setOrg] = useState(localStorage.getItem('workpa_zd_org') || '');
  const [stFilter, setStFilter] = useState('unsolved');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSla, setShowSla] = useState(false);
  const toast = useToast();
  const isMobile = useIsMobile();

  useEffect(() => {
    localStorage.setItem('workpa_zd_org', org);
  }, [org]);

  useEffect(() => {
    Api.status().then(setStatus).catch((e) => setStatus({ enabled: true, ok: false, error: e.message }));
  }, []);
  const ready = status?.enabled && status?.ok !== false;

  useEffect(() => {
    if (!ready) return;
    Api.orgs().then(setOrgs).catch((e) => toast.error(e.message));
    Api.agents().then(setAgents).catch(() => {});
  }, [ready]);

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

  const visible = useMemo(() => {
    let list = tickets || [];
    if (stFilter === 'unsolved') list = list.filter((t) => !['solved', 'closed'].includes(t.status));
    else if (stFilter !== 'all') list = list.filter((t) => t.status === stFilter);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((t) => t.subject.toLowerCase().includes(s) || String(t.id).includes(s) || (t.requester?.name || '').toLowerCase().includes(s) || (t.assignee?.name || '').toLowerCase().includes(s));
    }
    return list;
  }, [tickets, stFilter, q]);

  const orgName = (id) => orgs.find((o) => String(o.id) === String(id))?.name || '';

  const update = async (t, patch) => {
    const prev = { status: t.status, assignee: t.assignee };
    setTickets((list) => list.map((x) => (x.id === t.id ? { ...x, ...('status' in patch ? { status: patch.status } : {}), ...('assigneeId' in patch ? { assignee: patch.assigneeId ? { id: Number(patch.assigneeId), name: agents.find((a) => String(a.id) === String(patch.assigneeId))?.name || `#${patch.assigneeId}` } : null } : {}) } : x)));
    try {
      await Api.update(t.id, patch);
      toast.success(`Ticket #${t.id} updated`, 'status' in patch ? `Status → ${STATUS_LABEL[patch.status]}` : patch.assigneeId ? `Assigned to ${agents.find((a) => String(a.id) === String(patch.assigneeId))?.name || ''}` : 'Unassigned');
    } catch (e) {
      setTickets((list) => list.map((x) => (x.id === t.id ? { ...x, ...prev } : x)));
      toast.error(`Ticket #${t.id}: ${e.message}`);
    }
  };

  const controls = (t) => (
    <>
      <select className="select input-sm w-130" value={t.status} disabled={t.status === 'closed'} onChange={(e) => update(t, { status: e.target.value })} onClick={(e) => e.stopPropagation()}>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
        {t.status === 'closed' && <option value="closed">Closed</option>}
      </select>
      <select className="select input-sm w-160" value={t.assignee?.id || ''} disabled={t.status === 'closed'} onChange={(e) => update(t, { assigneeId: e.target.value })} onClick={(e) => e.stopPropagation()}>
        <option value="">— Unassigned —</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        {t.assignee?.id && !agents.some((a) => String(a.id) === String(t.assignee.id)) && <option value={t.assignee.id}>{t.assignee.name}</option>}
      </select>
    </>
  );

  if (status && !status.enabled)
    return (
      <div className="card mx-auto max-w-xl">
        <h1 className="mb-2">Zendesk</h1>
        <p className="muted mb-3">Not configured yet. Add these variables to the server (Railway → Variables) and redeploy:</p>
        <pre className="rounded-lg bg-slate-50 p-3 text-[13px] leading-6">{`ZENDESK_SUBDOMAIN = yourcompany        (from yourcompany.zendesk.com)
ZENDESK_EMAIL     = agent@company.com  (the account the token belongs to)
ZENDESK_API_TOKEN = ...                (Admin Center → Apps and integrations → Zendesk API)`}</pre>
        <p className="muted mt-3 text-[13px]">Enable "Token access" on that Zendesk API page, then create a token.</p>
      </div>
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Zendesk</h1>
          <div className="sub">
            {status?.ok === false ? (
              <span className="text-red-600">Connection failed: {status.error}</span>
            ) : status?.user ? (
              <>
                Connected as <b>{status.user.name}</b> ({status.user.role}) · {orgs.length} clients
              </>
            ) : (
              'Connecting…'
            )}
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
          <input className="input input-sm w-180" type="search" placeholder="Search tickets…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-sm" onClick={load} disabled={busy} title="Refresh">
            <RefreshIcon /> {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* SLA overview for the selected client */}
      {sla && (
        <div className="card mb-4">
          <div className="row wrap items-center justify-between">
            <div className="row wrap items-center gap-2">
              <b className="text-[14px]">SLA — {org ? orgName(org) : 'all clients'}</b>
              <span className="badge bg-slate-100 text-slate-600">{sla.live.open} open</span>
              <span className={`badge ${sla.live.breached.length ? 'bg-red-600 text-white' : 'bg-emerald-100 text-emerald-700'}`}>{sla.live.breached.length} breached</span>
              <span className={`badge ${sla.live.atRisk.length ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{sla.live.atRisk.length} at risk (&lt;4h)</span>
            </div>
            <button className="btn btn-xs btn-ghost" onClick={() => setShowSla((v) => !v)}>
              {showSla ? 'Hide targets' : `Targets (${sla.policies.length} polic${sla.policies.length === 1 ? 'y' : 'ies'})`}
            </button>
          </div>
          {(sla.live.breached.length > 0 || sla.live.atRisk.length > 0) && (
            <div className="mt-2 flex flex-col gap-1 text-[13px]">
              {[...sla.live.breached.map((t) => ({ ...t, breached: true })), ...sla.live.atRisk].slice(0, 6).map((t) => (
                <div key={`${t.id}-${t.metric}`} className="row items-center gap-2">
                  <span className={`badge ${t.breached ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800'}`}>{t.breached ? 'Breached' : minsLabel(Math.max(0, dayjs(t.breachAt).diff(dayjs(), 'minute')))}</span>
                  <span className="muted">#{t.id}</span>
                  <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                  <span className="muted whitespace-nowrap">({METRIC_LABEL[t.metric] || t.metric})</span>
                </div>
              ))}
            </div>
          )}
          {showSla && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {sla.policies.length === 0 && <div className="muted text-[13px]">No SLA policies apply{org ? ' to this client' : ''} (or your Zendesk plan has none).</div>}
              {sla.policies.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="font-semibold text-[13px]">{p.title}</div>
                  {p.description && <div className="muted text-[12px]">{p.description}</div>}
                  <table className="mt-2 w-full text-[12px]">
                    <tbody>
                      {p.metrics.map((m, i) => (
                        <tr key={i}>
                          <td className="py-0.5 capitalize text-slate-500">{m.priority}</td>
                          <td className="py-0.5">{METRIC_LABEL[m.metric] || m.metric}</td>
                          <td className="py-0.5 text-right font-medium">{minsLabel(m.targetMinutes)}</td>
                          <td className="py-0.5 pl-2 text-slate-400">{m.businessHours ? 'business hrs' : 'calendar'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-3">
        <Segmented
          value={stFilter}
          onChange={setStFilter}
          options={[
            { value: 'unsolved', label: 'Unsolved' },
            ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {tickets === null && <div className="card"><Empty icon="⏳" text="Loading tickets…" /></div>}
      {tickets !== null && visible.length === 0 && <div className="card"><Empty icon="🎫" text="No tickets match." /></div>}

      {visible.length > 0 && isMobile && (
        <div className="flex flex-col gap-2">
          {visible.map((t) => (
            <div key={t.id} className="card !p-4">
              <a className="font-medium hover:text-primary-600" href={t.url} target="_blank" rel="noreferrer">
                #{t.id} · {t.subject}
              </a>
              <div className="row wrap mt-1 items-center gap-2 text-[12px] text-slate-500">
                <span className={`badge ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                {t.priority && <span className={PRIORITY_CLS[t.priority]}>{t.priority}</span>}
                {!org && t.organizationId && <span>🏢 {orgName(t.organizationId)}</span>}
                {t.requester && <span>👤 {t.requester.name}</span>}
                <SlaChip sla={t.sla} />
              </div>
              <div className="row mt-2 gap-2">{controls(t)}</div>
            </div>
          ))}
        </div>
      )}

      {visible.length > 0 && !isMobile && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="task-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Subject</th>
                {!org && <th>Client</th>}
                <th>Priority</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>SLA</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id}>
                  <td className="muted">{t.id}</td>
                  <td>
                    <a className="font-medium hover:text-primary-600" href={t.url} target="_blank" rel="noreferrer" title="Open in Zendesk">
                      {t.subject}
                    </a>
                    {t.requester && <div className="muted text-[12px]">{t.requester.name}</div>}
                  </td>
                  {!org && <td className="muted">{t.organizationId ? orgName(t.organizationId) || '—' : '—'}</td>}
                  <td className={`capitalize ${PRIORITY_CLS[t.priority] || 'text-slate-400'}`}>{t.priority || '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select className="select input-sm w-120" value={t.status} disabled={t.status === 'closed'} onChange={(e) => update(t, { status: e.target.value })}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                      {t.status === 'closed' && <option value="closed">Closed</option>}
                    </select>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select className="select input-sm w-160" value={t.assignee?.id || ''} disabled={t.status === 'closed'} onChange={(e) => update(t, { assigneeId: e.target.value })}>
                      <option value="">— Unassigned —</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                      {t.assignee?.id && !agents.some((a) => String(a.id) === String(t.assignee.id)) && <option value={t.assignee.id}>{t.assignee.name}</option>}
                    </select>
                  </td>
                  <td>
                    <SlaChip sla={t.sla} />
                  </td>
                  <td className="muted whitespace-nowrap">{dayjs(t.updatedAt).fromNow()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
