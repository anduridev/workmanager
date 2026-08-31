// Shared bits for the Zendesk screens (Tickets, SLA Policies, SLA Report)
import { useEffect, useState } from 'react';
import { Zendesk as Api } from '../../lib/api';
import { dayjs, fmtDateTime } from '../../lib/date';

export const STATUSES = ['new', 'open', 'pending', 'hold', 'solved'];
export const STATUS_LABEL = { new: 'New', open: 'Open', pending: 'Pending', hold: 'On hold', solved: 'Solved', closed: 'Closed' };
export const STATUS_CLS = {
  new: 'bg-amber-100 text-amber-800',
  open: 'bg-red-100 text-red-700',
  pending: 'bg-sky-100 text-sky-700',
  hold: 'bg-slate-200 text-slate-700',
  solved: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-100 text-slate-500',
};
export const PRIORITY_CLS = { urgent: 'text-red-600', high: 'text-amber-600', normal: 'text-slate-500', low: 'text-slate-400' };

export const METRIC_LABEL = {
  first_reply_time: 'First reply',
  next_reply_time: 'Next reply',
  periodic_update_time: 'Periodic update',
  pausable_update_time: 'Update',
  requester_wait_time: 'Requester wait',
  agent_work_time: 'Agent work',
  resolution_time: 'Resolution',
};
// What each SLA metric actually measures (shown on the read-only Policies screen)
export const METRIC_EXPLAIN = {
  first_reply_time: 'Time from ticket creation until the first public reply from an agent.',
  next_reply_time: 'Time from the requester’s newest reply until the agent’s next public reply.',
  periodic_update_time: 'Maximum time allowed between public agent updates on the ticket.',
  pausable_update_time: 'Time between agent updates; the clock pauses while the ticket is On hold.',
  requester_wait_time: 'Total time the ticket spends in New, Open or On hold — how long the client is kept waiting overall.',
  agent_work_time: 'Total time the ticket spends in New or Open — time it sits with your team.',
  resolution_time: 'Time from creation until the ticket is solved.',
};

export const minsLabel = (m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

/** SLA countdown chip: red when breached / <1h, amber <4h. */
export function SlaChip({ sla }) {
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

/** Connection status + client (organization) list, shared by all three screens. */
export function useZendesk() {
  const [status, setStatus] = useState(null);
  const [orgs, setOrgs] = useState([]);
  useEffect(() => {
    Api.status().then(setStatus).catch((e) => setStatus({ enabled: true, ok: false, error: e.message }));
  }, []);
  const ready = Boolean(status?.enabled && status?.ok !== false);
  useEffect(() => {
    if (!ready) return;
    Api.orgs().then(setOrgs).catch(() => {});
  }, [ready]);
  const orgName = (id) => orgs.find((o) => String(o.id) === String(id))?.name || '';
  return { status, ready, orgs, orgName };
}

/** Header sub-line: connection state. */
export function ConnLine({ status, orgs }) {
  if (status?.ok === false) return <span className="text-red-600">Connection failed: {status.error}</span>;
  if (status?.user)
    return (
      <>
        Connected as <b>{status.user.name}</b> ({status.user.role}) · {orgs.length} clients
      </>
    );
  return 'Connecting…';
}

/** Setup card when the env vars are missing. */
export function NotConfigured({ title = 'Zendesk' }) {
  return (
    <div className="card mx-auto max-w-xl">
      <h1 className="mb-2">{title}</h1>
      <p className="muted mb-3">Not configured yet. Add these variables to the server (Railway → Variables) and redeploy:</p>
      <pre className="rounded-lg bg-slate-50 p-3 text-[13px] leading-6">{`ZENDESK_SUBDOMAIN = yourcompany        (from yourcompany.zendesk.com)
ZENDESK_EMAIL     = agent@company.com  (the account the token belongs to)
ZENDESK_API_TOKEN = ...                (Admin Center → Apps and integrations → Zendesk API)`}</pre>
      <p className="muted mt-3 text-[13px]">Enable "Token access" on that Zendesk API page, then create a token.</p>
    </div>
  );
}
