import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zendesk as Api } from '../../lib/api';
import { dayjs, fmtDateTime } from '../../lib/date';
import { Empty, Segmented } from '../../components/ui';
import Modal, { Drawer } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useIsMobile } from '../../lib/useMedia';
import { RefreshIcon, PlusIcon } from '../../components/icons';
import { STATUSES, STATUS_LABEL, STATUS_CLS, PRIORITIES, TYPES, PRIORITY_CLS, PRIORITY_DOT, SlaChip, Avatar, fmtBytes, useZendesk, ConnLine, NotConfigured } from './lib';

const PriorityMark = ({ p }) => (
  <span className={`inline-flex items-center gap-1.5 capitalize ${PRIORITY_CLS[p] || 'text-slate-400'}`}>
    <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[p] || 'bg-slate-200'}`} />
    {p || '—'}
  </span>
);

/** Full ticket: conversation (replies + internal notes), inline field edits, reply box. */
function TicketDrawer({ id, agents, orgName, onClose, onChanged }) {
  const [t, setT] = useState(null);
  const [reply, setReply] = useState('');
  const [mode, setMode] = useState('public'); // public | internal
  const [sending, setSending] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const toast = useToast();
  const navigate = useNavigate();

  const load = useCallback(() => Api.get(id).then(setT).catch((e) => toast.error(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  const patch = async (data, note) => {
    try {
      await Api.update(id, data);
      toast.success(`Ticket #${id} updated`, note || '');
      load();
      onChanged();
    } catch (e) {
      toast.error(e.message);
      load();
    }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await Api.update(id, { comment: { body: reply.trim(), public: mode === 'public' } });
      toast.success(mode === 'public' ? 'Reply sent to the requester' : 'Internal note added');
      setReply('');
      load();
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase().replace(/\s+/g, '_');
    if (!tag || t.tags.includes(tag)) return setTagInput('');
    setTagInput('');
    patch({ tags: [...t.tags, tag] }, `Tag "${tag}" added`);
  };

  const closed = t?.status === 'closed';
  const sel = 'select input-sm';

  return (
    <Drawer
      onClose={onClose}
      title={
        t ? (
          <div className="min-w-0">
            <div className="row wrap items-center gap-2">
              <span className={`badge ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
              <PriorityMark p={t.priority} />
              {t.type && <span className="badge badge-outline capitalize">{t.type}</span>}
              {t.organizationId && <span className="muted text-[12px]">🏢 {orgName(t.organizationId)}</span>}
            </div>
            <div className="mt-1 text-[15px] font-semibold leading-snug">{t.subject}</div>
            <div className="muted mt-0.5 text-[12px]">
              <a className="hover:text-primary-600" href={t.url} target="_blank" rel="noreferrer">
                #{t.id} · open in Zendesk ↗
              </a>{' '}
              · created {fmtDateTime(t.createdAt)}
            </div>
          </div>
        ) : (
          `Ticket #${id}`
        )
      }
    >
      {!t && <div className="muted p-2 text-[13px]">Loading conversation…</div>}
      {t && (
        <>
          {/* quick actions */}
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="field !gap-1 text-[11px]">
              Status
              <select className={sel} value={t.status} disabled={closed} onChange={(e) => patch({ status: e.target.value }, `Status → ${STATUS_LABEL[e.target.value]}`)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
                {closed && <option value="closed">Closed</option>}
              </select>
            </label>
            <label className="field !gap-1 text-[11px]">
              Priority
              <select className={sel} value={t.priority || ''} disabled={closed} onChange={(e) => patch({ priority: e.target.value }, e.target.value ? `Priority → ${e.target.value}` : 'Priority cleared')}>
                <option value="">—</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p} className="capitalize">
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="field !gap-1 text-[11px]">
              Type
              <select className={sel} value={t.type || ''} disabled={closed} onChange={(e) => patch({ type: e.target.value }, e.target.value ? `Type → ${e.target.value}` : 'Type cleared')}>
                <option value="">—</option>
                {TYPES.map((x) => (
                  <option key={x} value={x} className="capitalize">
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="field !gap-1 text-[11px]">
              Assignee
              <select className={sel} value={t.assignee?.id || ''} disabled={closed} onChange={(e) => patch({ assigneeId: e.target.value }, e.target.value ? 'Reassigned' : 'Unassigned')}>
                <option value="">— Unassigned —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* requester + tags */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
            {t.requester && (
              <span className="row items-center gap-2 text-[13px]">
                <Avatar name={t.requester.name} size="h-6 w-6 text-[10px]" />
                <b>{t.requester.name}</b>
                {t.requester.email && <span className="muted text-[12px]">{t.requester.email}</span>}
              </span>
            )}
            <span className="mx-1 hidden text-slate-300 md:inline">·</span>
            {t.tags.map((tag) => (
              <span key={tag} className="badge badge-tag">
                {tag}
                {!closed && (
                  <button className="ml-1 opacity-50 hover:opacity-100" title="Remove tag" onClick={() => patch({ tags: t.tags.filter((x) => x !== tag) }, `Tag "${tag}" removed`)}>
                    ×
                  </button>
                )}
              </span>
            ))}
            {!closed && (
              <input
                className="w-24 rounded-md border border-dashed border-slate-300 bg-transparent px-2 py-0.5 text-[12px] outline-none focus:border-primary-400"
                placeholder="+ tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                onBlur={() => tagInput.trim() && addTag()}
              />
            )}
            <button className="btn btn-xs ml-auto" onClick={() => navigate(`/tasks?new=1&title=${encodeURIComponent(`[Zendesk #${t.id}] ${t.subject.slice(0, 110)}`)}`)} title="Track this ticket as a WorkPA task">
              + WorkPA task
            </button>
          </div>

          {/* conversation */}
          <div className="flex flex-col gap-2">
            {t.comments.map((c) => (
              <div key={c.id} className={`rounded-xl border p-3 ${!c.public ? 'border-amber-200 bg-amber-50/70' : c.agent ? 'border-primary-100 bg-primary-50/40' : 'border-slate-200 bg-white'}`}>
                <div className="row items-center gap-2">
                  <Avatar name={c.author} size="h-6 w-6 text-[10px]" cls={c.agent ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600'} />
                  <b className="text-[13px]">{c.author}</b>
                  {!c.public && <span className="badge bg-amber-200 text-amber-900">Internal note</span>}
                  <span className="muted ml-auto text-[11px]">{fmtDateTime(c.createdAt)}</span>
                </div>
                <div className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{c.body}</div>
                {c.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.attachments.map((a, i) => (
                      <a key={i} className="row items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] hover:border-primary-300" href={a.url} target="_blank" rel="noreferrer">
                        📎 <span className="max-w-[180px] truncate font-medium">{a.name}</span>
                        <span className="muted">{fmtBytes(a.size)}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {t.comments.length === 0 && <Empty icon="💬" text="No conversation yet." />}
          </div>

          {/* reply box */}
          {!closed && (
            <div className={`mt-3 rounded-xl border p-3 ${mode === 'internal' ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
              <div className="row mb-2 items-center gap-2">
                <Segmented
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'public', label: 'Public reply' },
                    { value: 'internal', label: 'Internal note' },
                  ]}
                />
                <span className="muted text-[11px]">{mode === 'public' ? 'The requester sees this' : 'Only agents see this'}</span>
              </div>
              <textarea
                className="textarea w-full"
                rows={3}
                placeholder={mode === 'public' ? `Reply to ${t.requester?.name || 'the requester'}…` : 'Note for the team…'}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <div className="row mt-2 justify-end gap-2">
                <button className="btn btn-sm" onClick={() => patch({ status: 'solved', ...(reply.trim() ? { comment: { body: reply.trim(), public: mode === 'public' } } : {}) }, 'Solved')} disabled={sending}>
                  ✓ {reply.trim() ? 'Send & solve' : 'Mark solved'}
                </button>
                <button className="btn btn-sm btn-primary" onClick={sendReply} disabled={sending || !reply.trim()}>
                  {sending ? 'Sending…' : mode === 'public' ? 'Send reply' : 'Add note'}
                </button>
              </div>
            </div>
          )}
          {closed && <div className="muted mt-3 text-center text-[12px]">This ticket is closed — Zendesk does not allow further changes.</div>}
        </>
      )}
    </Drawer>
  );
}

/** Create a new ticket for a client. */
function NewTicketModal({ orgs, agents, defaultOrg, onClose, onCreated }) {
  const [form, setForm] = useState({ orgId: defaultOrg || '', requesterId: '', requesterEmail: '', requesterName: '', subject: '', body: '', priority: 'normal', type: '', assigneeId: '' });
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    setUsers([]);
    setForm((f) => ({ ...f, requesterId: '' }));
    if (form.orgId) Api.orgUsers(form.orgId).then(setUsers).catch(() => setUsers([]));
  }, [form.orgId]);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await Api.create({ ...form, orgId: form.orgId || null });
      toast.success(`Ticket #${r.id} created`, form.subject);
      onCreated(r.id);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const canSave = form.subject.trim() && form.body.trim() && (form.requesterId || form.requesterEmail.trim());
  return (
    <Modal
      title="New Zendesk ticket"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !canSave}>
            {busy ? 'Creating…' : 'Create ticket'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          Client
          <select className="select" value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })}>
            <option value="">— No client —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Requester
          <select className="select" value={form.requesterId} onChange={(e) => setForm({ ...form, requesterId: e.target.value })}>
            <option value="">— New / by email below —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} {u.email ? `(${u.email})` : ''}
              </option>
            ))}
          </select>
        </label>
        {!form.requesterId && (
          <>
            <label className="field">
              Requester email
              <input className="input" type="email" placeholder="person@client.com" value={form.requesterEmail} onChange={(e) => setForm({ ...form, requesterEmail: e.target.value })} />
            </label>
            <label className="field">
              Requester name (optional)
              <input className="input" value={form.requesterName} onChange={(e) => setForm({ ...form, requesterName: e.target.value })} />
            </label>
          </>
        )}
        <label className="field full">
          Subject
          <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </label>
        <label className="field full">
          Description (first message)
          <textarea className="textarea" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </label>
        <label className="field">
          Priority
          <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p} className="capitalize">
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Type
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="">—</option>
            {TYPES.map((x) => (
              <option key={x} value={x} className="capitalize">
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Assign to
          <select className="select" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
            <option value="">— Unassigned —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}

export default function Tickets() {
  const { status, ready, orgs, orgName } = useZendesk();
  const [agents, setAgents] = useState([]);
  const [tickets, setTickets] = useState(null);
  const [org, setOrg] = useState(localStorage.getItem('workpa_zd_org') || '');
  const [stFilter, setStFilter] = useState('unsolved');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
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

  const counts = useMemo(() => {
    const c = { unsolved: 0, all: (tickets || []).length };
    (tickets || []).forEach((t) => {
      c[t.status] = (c[t.status] || 0) + 1;
      if (!['solved', 'closed'].includes(t.status)) c.unsolved++;
    });
    return c;
  }, [tickets]);

  const visible = useMemo(() => {
    let list = tickets || [];
    if (stFilter === 'unsolved') list = list.filter((t) => !['solved', 'closed'].includes(t.status));
    else if (stFilter !== 'all') list = list.filter((t) => t.status === stFilter);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((t) => t.subject.toLowerCase().includes(s) || String(t.id).includes(s) || (t.requester?.name || '').toLowerCase().includes(s) || (t.assignee?.name || '').toLowerCase().includes(s) || (t.tags || []).some((x) => x.includes(s)));
    }
    return list;
  }, [tickets, stFilter, q]);

  const update = async (t, patch) => {
    const prev = { status: t.status, assignee: t.assignee, priority: t.priority };
    setTickets((list) =>
      list.map((x) =>
        x.id === t.id
          ? {
              ...x,
              ...('status' in patch ? { status: patch.status } : {}),
              ...('priority' in patch ? { priority: patch.priority || null } : {}),
              ...('assigneeId' in patch ? { assignee: patch.assigneeId ? { id: Number(patch.assigneeId), name: agents.find((a) => String(a.id) === String(patch.assigneeId))?.name || `#${patch.assigneeId}` } : null } : {}),
            }
          : x
      )
    );
    try {
      await Api.update(t.id, patch);
      toast.success(`Ticket #${t.id} updated`);
    } catch (e) {
      setTickets((list) => list.map((x) => (x.id === t.id ? { ...x, ...prev } : x)));
      toast.error(`Ticket #${t.id}: ${e.message}`);
    }
  };

  if (status && !status.enabled) return <NotConfigured title="Zendesk · Tickets" />;

  const filterOptions = [
    { value: 'unsolved', label: `Unsolved${counts.unsolved ? ` · ${counts.unsolved}` : ''}` },
    ...STATUSES.map((s) => ({ value: s, label: `${STATUS_LABEL[s]}${counts[s] ? ` · ${counts[s]}` : ''}` })),
    { value: 'all', label: `All · ${counts.all}` },
  ];

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
          <input className="input input-sm w-180" type="search" placeholder="Search subject, #, tag…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-sm" onClick={load} disabled={busy} title="Refresh">
            <RefreshIcon /> {busy ? '…' : 'Refresh'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
            <PlusIcon size={15} /> Ticket
          </button>
        </div>
      </div>

      <div className="mb-3 overflow-x-auto">
        <Segmented value={stFilter} onChange={setStFilter} options={filterOptions} />
      </div>

      {tickets === null && <div className="card"><Empty icon="⏳" text="Loading tickets…" /></div>}
      {tickets !== null && visible.length === 0 && <div className="card"><Empty icon="🎫" text="No tickets match." /></div>}

      {visible.length > 0 && isMobile && (
        <div className="flex flex-col gap-2">
          {visible.map((t) => (
            <div key={t.id} className="card !p-4" onClick={() => setOpenId(t.id)}>
              <div className="row items-start gap-2.5">
                <Avatar name={t.requester?.name} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-snug">{t.subject}</div>
                  <div className="row wrap mt-1 items-center gap-2 text-[12px] text-slate-500">
                    <span className="muted">#{t.id}</span>
                    <span className={`badge ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                    <PriorityMark p={t.priority} />
                    {!org && t.organizationId && <span>🏢 {orgName(t.organizationId)}</span>}
                    <SlaChip sla={t.sla} />
                  </div>
                  <div className="row wrap mt-1 items-center gap-2 text-[12px] text-slate-400">
                    <span>👤 {t.requester?.name || '—'}</span>
                    <span>→ {t.assignee?.name || 'Unassigned'}</span>
                    <span className="ml-auto">{dayjs(t.updatedAt).fromNow(true)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {visible.length > 0 && !isMobile && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="task-table">
            <thead>
              <tr>
                <th>Ticket</th>
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
                <tr key={t.id} className="cursor-pointer" onClick={() => setOpenId(t.id)}>
                  <td>
                    <div className="row items-center gap-2.5">
                      <Avatar name={t.requester?.name} />
                      <div className="min-w-0">
                        <div className="font-medium leading-snug hover:text-primary-600">{t.subject}</div>
                        <div className="row wrap mt-0.5 items-center gap-1.5 text-[12px] text-slate-400">
                          <span>#{t.id}</span>
                          <span>· {t.requester?.name || '—'}</span>
                          {t.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="badge badge-tag !text-[10px]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  {!org && <td className="muted whitespace-nowrap">{t.organizationId ? orgName(t.organizationId) || '—' : '—'}</td>}
                  <td onClick={(e) => e.stopPropagation()}>
                    <select className="select input-sm w-110 capitalize" value={t.priority || ''} disabled={t.status === 'closed'} onChange={(e) => update(t, { priority: e.target.value })}>
                      <option value="">—</option>
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p} className="capitalize">
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
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
                    <select className="select input-sm w-150" value={t.assignee?.id || ''} disabled={t.status === 'closed'} onChange={(e) => update(t, { assigneeId: e.target.value })}>
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

      {openId && <TicketDrawer id={openId} agents={agents} orgName={orgName} onClose={() => setOpenId(null)} onChanged={load} />}
      {creating && (
        <NewTicketModal
          orgs={orgs}
          agents={agents}
          defaultOrg={org}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            load();
            setOpenId(id);
          }}
        />
      )}
    </>
  );
}
