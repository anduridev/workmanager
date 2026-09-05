import { useEffect, useMemo, useState } from 'react';
import { Zendesk as Api } from '../../lib/api';
import { Empty } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { METRIC_LABEL, METRIC_EXPLAIN, PRIORITY_DOT, minsLabel, useZendesk, ConnLine, NotConfigured } from './lib';

const PRIO_ORDER = ['low', 'normal', 'high', 'urgent'];
const TICKET_TYPE_ID = { 1: 'Question', 2: 'Incident', 3: 'Problem', 4: 'Task' };
const OP_LABEL = {
  is: 'is',
  is_not: 'is not',
  includes: 'is any of',
  not_includes: 'is none of',
  less_than: 'is under',
  greater_than: 'is over',
  present: 'is set',
  not_present: 'is not set',
};

/** "organization.custom_fields.client_name" -> "client name"; "custom_fields_123" -> "custom field". */
function fieldLabel(field) {
  return String(field)
    .replace(/^organization\.custom_fields\./, '')
    .replace(/^ticket\.custom_fields\./, '')
    .replace(/^custom_fields_\d+$/, 'custom field')
    .replace(/^organization_id$/, 'client')
    .replace(/^ticket_type_id$/, 'ticket type')
    .replace(/^group_id$/, 'group')
    .replace(/^brand_id$/, 'brand')
    .replace(/^custom_status_id$/, 'custom status')
    .replace(/^via_type$/, 'channel')
    .replace(/[_.]/g, ' ')
    .trim();
}

/** Resolve a condition value to something readable (org names for long ids, ticket types, …). */
function valLabel(field, v, orgName) {
  if (field === 'ticket_type_id') return TICKET_TYPE_ID[v] || String(v);
  const s = String(v);
  if (/^\d+$/.test(s)) return orgName(s) || (s.length >= 8 ? `…${s.slice(-6)}` : s);
  return s;
}

/** Merge conditions that share field+operator+mode into one row with all values. */
function groupConditions(conds) {
  const map = new Map();
  conds.forEach((c) => {
    const key = `${c.mode}|${c.field}|${c.operator}`;
    if (!map.has(key)) map.set(key, { field: c.field, operator: c.operator, mode: c.mode, values: [] });
    (Array.isArray(c.value) ? c.value : [c.value]).forEach((v) => map.get(key).values.push(v));
  });
  return [...map.values()];
}

/** metric -> { low: {t,bh}, normal: … } for the compact matrix. */
function matrix(metrics) {
  const rows = new Map();
  metrics.forEach((m) => {
    if (!rows.has(m.metric)) rows.set(m.metric, {});
    rows.get(m.metric)[m.priority] = { t: minsLabel(m.targetMinutes), bh: m.businessHours };
  });
  return [...rows.entries()];
}

/** One short readable sentence per policy. */
function summary(p, grouped, orgName) {
  const parts = [];
  const type = grouped.find((g) => g.field === 'ticket_type_id');
  const clients = grouped.find((g) => /client|organization/.test(fieldLabel(g.field)) && g.values.some((v) => /^\d{8,}$/.test(String(v))));
  if (type) parts.push(`${type.values.map((v) => TICKET_TYPE_ID[v] || v).join(' & ')} tickets`);
  else parts.push('tickets');
  if (clients) {
    const names = clients.values.map((v) => valLabel(clients.field, v, orgName));
    parts.push(`of ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2} more clients` : ''}`);
  }
  const urgent = p.metrics.filter((m) => m.priority === 'urgent').sort((a, b) => a.targetMinutes - b.targetMinutes)[0];
  const fastest = urgent || [...p.metrics].sort((a, b) => a.targetMinutes - b.targetMinutes)[0];
  const promise = fastest ? ` Fastest promise: ${(METRIC_LABEL[fastest.metric] || fastest.metric).toLowerCase()} within ${minsLabel(fastest.targetMinutes)} on ${fastest.priority} tickets.` : '';
  return `Covers ${parts.join(' ')}.${promise}`;
}

function Chips({ values, field, orgName }) {
  const [all, setAll] = useState(false);
  const shown = all ? values : values.slice(0, 4);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((v, i) => (
        <span key={i} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] font-medium text-slate-700">
          {valLabel(field, v, orgName)}
        </span>
      ))}
      {values.length > 4 && (
        <button className="text-[11px] text-primary-600 hover:underline" onClick={() => setAll((x) => !x)}>
          {all ? 'less' : `+${values.length - 4} more`}
        </button>
      )}
    </span>
  );
}

export default function Policies() {
  const { status, ready, orgs, orgName } = useZendesk();
  const [policies, setPolicies] = useState(null);
  const toast = useToast();

  useEffect(() => {
    if (!ready) return;
    Api.policies().then(setPolicies).catch((e) => toast.error(e.message));
  }, [ready]);

  const usedMetrics = useMemo(() => [...new Set((policies || []).flatMap((p) => p.metrics.map((m) => m.metric)))], [policies]);

  if (status && !status.enabled) return <NotConfigured title="Zendesk · SLA Policies" />;

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
          {policies.map((p, i) => {
            const grouped = groupConditions(p.conditions);
            const rows = matrix(p.metrics);
            const prios = PRIO_ORDER.filter((pr) => p.metrics.some((m) => m.priority === pr));
            const allCalendar = p.metrics.every((m) => !m.businessHours);
            const allBusiness = p.metrics.every((m) => m.businessHours);
            return (
              <div key={p.id} className="card !p-0 overflow-hidden">
                <div className="flex items-start gap-3 border-b border-slate-100 bg-gradient-to-r from-primary-50/70 to-white px-5 py-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-600 text-[13px] font-bold text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-semibold leading-tight">{p.title}</h2>
                    <p className="mt-0.5 text-[13px] text-slate-600">{summary(p, grouped, orgName)}</p>
                    {p.description && <p className="muted mt-0.5 text-[12px]">{p.description}</p>}
                  </div>
                </div>

                <div className="grid gap-0 md:grid-cols-[minmax(240px,1fr)_minmax(0,1.4fr)]">
                  <div className="border-b border-slate-100 p-5 md:border-b-0 md:border-r">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Applies when</div>
                    {grouped.length === 0 && <div className="muted text-[13px]">Always — no conditions.</div>}
                    <div className="flex flex-col gap-2">
                      {grouped.map((g, j) => (
                        <div key={j} className="text-[13px] leading-relaxed">
                          <span className="font-medium capitalize text-slate-700">{fieldLabel(g.field)}</span>{' '}
                          <span className="text-slate-400">{g.values.length > 1 ? (g.operator === 'is_not' ? 'is none of' : 'is any of') : OP_LABEL[g.operator] || g.operator.replace(/_/g, ' ')}</span>{' '}
                          <Chips values={g.values} field={g.field} orgName={orgName} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-5" style={{ overflowX: 'auto' }}>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Targets {allCalendar ? '· calendar hours' : allBusiness ? '· business hours' : ''}
                    </div>
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr>
                          <th className="pb-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Metric</th>
                          {prios.map((pr) => (
                            <th key={pr} className="pb-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              <span className={`mr-1 inline-block h-2 w-2 rounded-full ${PRIORITY_DOT[pr]}`} />
                              {pr}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(([metric, byPrio]) => (
                          <tr key={metric} className="border-t border-slate-100">
                            <td className="py-1.5 text-slate-600">{METRIC_LABEL[metric] || metric.replace(/_/g, ' ')}</td>
                            {prios.map((pr) => (
                              <td key={pr} className="py-1.5 text-right font-semibold tabular-nums">
                                {byPrio[pr] ? (
                                  <>
                                    {byPrio[pr].t}
                                    {!allCalendar && !allBusiness && byPrio[pr].bh && <span className="ml-0.5 align-super text-[9px] font-normal text-slate-400">bh</span>}
                                  </>
                                ) : (
                                  <span className="font-normal text-slate-300">—</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!allCalendar && !allBusiness && <p className="muted mt-1.5 text-[11px]">ᵇʰ = business hours (the clock pauses outside your Zendesk schedule)</p>}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="card">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">What the metrics mean</div>
            <div className="grid gap-x-6 gap-y-1.5 text-[13px] leading-relaxed md:grid-cols-2">
              {[...new Set(usedMetrics.map((m) => METRIC_LABEL[m] || m))].map((label) => {
                const key = usedMetrics.find((m) => (METRIC_LABEL[m] || m) === label);
                return (
                  <div key={label}>
                    <b>{label}</b> <span className="text-slate-500">— {METRIC_EXPLAIN[key] || ''}</span>
                  </div>
                );
              })}
            </div>
            <p className="muted mt-2 text-[12px]">
              <b>Calendar hours</b> count around the clock; <b>business hours</b> only count within your Zendesk schedule (weekends and off-hours pause the clock).
            </p>
          </div>
        </div>
      )}
    </>
  );
}
