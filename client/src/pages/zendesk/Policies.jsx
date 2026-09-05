import { useEffect, useState } from 'react';
import { Zendesk as Api } from '../../lib/api';
import { Empty } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { METRIC_LABEL, METRIC_EXPLAIN, PRIORITY_CLS, PRIORITY_DOT, minsLabel, useZendesk, ConnLine, NotConfigured } from './lib';

const FIELD_LABEL = {
  organization_id: 'client',
  priority: 'priority',
  ticket_type: 'type',
  group_id: 'group',
  brand_id: 'brand',
  assignee_id: 'assignee',
  requester_id: 'requester',
  tags: 'tags',
  via_type: 'channel',
  satisfaction_score: 'satisfaction',
};
const OP_LABEL = {
  is: 'is',
  is_not: 'is not',
  includes: 'includes',
  not_includes: 'does not include',
  less_than: 'is less than',
  greater_than: 'is greater than',
  present: 'is set',
  not_present: 'is not set',
};

/** One condition -> plain English ("client is Acme Corp"). */
function condText(c, orgName) {
  const field = FIELD_LABEL[c.field] || c.field.replace(/_/g, ' ');
  const op = OP_LABEL[c.operator] || c.operator.replace(/_/g, ' ');
  let value = Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '');
  if (c.field === 'organization_id') value = Array.isArray(c.value) ? c.value.map((v) => orgName(v) || `#${v}`).join(', ') : orgName(c.value) || `#${c.value}`;
  return `${field} ${op} ${value}`.trim();
}

/** Auto-written explanation of a policy from its data. */
function explain(p, orgName) {
  const all = p.conditions.filter((c) => c.mode === 'all');
  const any = p.conditions.filter((c) => c.mode === 'any');
  let who = 'It applies to every ticket (no conditions).';
  if (all.length || any.length) {
    const parts = [];
    if (all.length) parts.push(all.map((c) => condText(c, orgName)).join(' and '));
    if (any.length) parts.push(`${all.length ? 'and ' : ''}at least one of: ${any.map((c) => condText(c, orgName)).join('; ')}`);
    who = `It applies to tickets where ${parts.join(', ')}.`;
  }
  const byPrio = {};
  p.metrics.forEach((m) => {
    (byPrio[m.priority] = byPrio[m.priority] || []).push(m);
  });
  const targets = Object.entries(byPrio)
    .map(([prio, ms]) => `${prio} tickets: ${ms.map((m) => `${(METRIC_LABEL[m.metric] || m.metric).toLowerCase()} within ${minsLabel(m.targetMinutes)}${m.businessHours ? ' (business hours)' : ''}`).join(', ')}`)
    .join('. ');
  return `${who} ${targets ? `Targets — ${targets}.` : 'It defines no targets.'}`;
}

export default function Policies() {
  const { status, ready, orgs, orgName } = useZendesk();
  const [policies, setPolicies] = useState(null);
  const toast = useToast();

  useEffect(() => {
    if (!ready) return;
    Api.policies().then(setPolicies).catch((e) => toast.error(e.message));
  }, [ready]);

  if (status && !status.enabled) return <NotConfigured title="Zendesk · SLA Policies" />;

  const usedMetrics = [...new Set((policies || []).flatMap((p) => p.metrics.map((m) => m.metric)))];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>SLA Policies</h1>
          <div className="sub">
            Read-only, straight from Zendesk — edit them in Admin Center. <ConnLine status={status} orgs={orgs} />
          </div>
        </div>
      </div>

      {policies === null && <div className="card"><Empty icon="⏳" text="Loading policies…" /></div>}
      {policies !== null && policies.length === 0 && (
        <div className="card"><Empty icon="📋" text="No SLA policies found (or your Zendesk plan does not include SLAs)." /></div>
      )}

      {(policies || []).length > 0 && (
        <div className="flex flex-col gap-4">
          {policies.map((p, i) => (
            <div key={p.id} className="card border-l-4 !border-l-primary-400">
              <div className="row items-center gap-2">
                <span className="badge bg-slate-100 text-slate-600">Policy {i + 1}</span>
                <h2 className="text-[15px] font-semibold">{p.title}</h2>
              </div>
              {p.description && <div className="muted mt-1 text-[13px]">{p.description}</div>}

              <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50/50 p-3 text-[13px] leading-relaxed">
                <b>In plain words:</b> {explain(p, orgName)}
              </div>

              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Applies when</div>
                  {p.conditions.length === 0 && <div className="muted text-[13px]">Always — no conditions.</div>}
                  <ul className="list-inside list-disc text-[13px] leading-6">
                    {p.conditions.map((c, j) => (
                      <li key={j}>
                        {condText(c, orgName)} {c.mode === 'any' && <span className="muted text-[11px]">(any-of group)</span>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Targets</div>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-1 font-semibold">Priority</th>
                        <th className="py-1 font-semibold">Metric</th>
                        <th className="py-1 text-right font-semibold">Target</th>
                        <th className="py-1 pl-2 font-semibold">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.metrics.map((m, j) => (
                        <tr key={j} className="border-t border-slate-100">
                          <td className={`py-1 capitalize ${PRIORITY_CLS[m.priority] || ''}`}>
                            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${PRIORITY_DOT[m.priority] || 'bg-slate-300'}`} />
                            {m.priority}
                          </td>
                          <td className="py-1">{METRIC_LABEL[m.metric] || m.metric}</td>
                          <td className="py-1 text-right font-medium">{minsLabel(m.targetMinutes)}</td>
                          <td className="py-1 pl-2 text-slate-400">{m.businessHours ? 'business' : 'calendar'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}

          <div className="card">
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-400">What the metrics mean</div>
            <ul className="list-inside list-disc text-[13px] leading-6">
              {(usedMetrics.length ? usedMetrics : Object.keys(METRIC_EXPLAIN)).map((m) => (
                <li key={m}>
                  <b>{METRIC_LABEL[m] || m}</b> — {METRIC_EXPLAIN[m] || ''}
                </li>
              ))}
            </ul>
            <p className="muted mt-2 text-[12px]">
              <b>Calendar hours</b> count around the clock; <b>business hours</b> only count within your Zendesk schedule (weekends and off-hours pause the clock).
            </p>
          </div>
        </div>
      )}
    </>
  );
}
