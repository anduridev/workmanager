import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zendesk as Api } from '../../lib/api';
import { dayjs } from '../../lib/date';
import { Empty, Segmented } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useIsMobile } from '../../lib/useMedia';
import { RefreshIcon } from '../../components/icons';
import { STATUSES, STATUS_LABEL, STATUS_CLS, PRIORITY_CLS, SlaChip, useZendesk, ConnLine, NotConfigured } from './lib';

export default function Tickets() {
  const { status, ready, orgs, orgName } = useZendesk();
  const [agents, setAgents] = useState([]);
  const [tickets, setTickets] = useState(null);
  const [org, setOrg] = useState(localStorage.getItem('workpa_zd_org') || '');
  const [stFilter, setStFilter] = useState('unsolved');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const isMobile = useIsMobile();

  useEffect(() => {
    localStorage.setItem('workpa_zd_org', org);
  }, [org]);
  useEffect(() => {
    if (!ready) return;
    Api.agents().then(setAgents).catch(() => {});
  }, [ready]);

  const load = useCallback(async () => {
    if (!ready) return;
    setBusy(true);
    try {
      setTickets(await Api.tickets({ org: org || undefined }));
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

  if (status && !status.enabled) return <NotConfigured title="Zendesk · Tickets" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tickets</h1>
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
          <input className="input input-sm w-180" type="search" placeholder="Search tickets…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-sm" onClick={load} disabled={busy} title="Refresh">
            <RefreshIcon /> {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

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
