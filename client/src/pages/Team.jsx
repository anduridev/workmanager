import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Members as MembersApi, Targets as TargetsApi } from '../lib/api';
import { dayjs, fmtDate, fmtDateTime, calendarDate, isPast, isToday, toLocalInput, toDateInput } from '../lib/date';
import { StatusBadge, Avatar, Empty, Segmented, TARGET_STATUS_LABEL, OUTCOME_LABEL } from '../components/ui';
import Modal, { Drawer } from '../components/Modal';
import { useToast } from '../components/Toast';
import { specFromDate, describe, WEEKDAYS } from '../lib/schedule';
import ScheduleFields, { specToPayload, specValid } from '../components/ScheduleFields';
import { useIsMobile } from '../lib/useMedia';

const REPEATS = [
  { value: 'none', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

/** Short label for a target's follow-up schedule, e.g. "Daily 10:00 AM until 30 Sep" */
function scheduleLabel(t) {
  if (!t.followUpAt) return '';
  const time = dayjs(t.followUpAt).format('hh:mm A');
  const until = t.followUpUntil ? ` until ${fmtDate(t.followUpUntil, 'DD MMM')}` : '';
  if (t.followUpRepeat === 'daily') return `Daily ${time}${until}`;
  if (t.followUpRepeat === 'weekly') return `Every ${WEEKDAYS[dayjs(t.followUpAt).day()].slice(0, 3)} ${time}${until}`;
  return '';
}

const T_STATUSES = ['pending', 'inprogress', 'hold', 'achieved', 'missed'];
const OPEN = ['pending', 'inprogress', 'hold'];
const blankTarget = (members = []) => ({
  title: '',
  description: '',
  members,
  status: 'pending',
  priority: 'medium',
  targetDate: '',
  spec: specFromDate(dayjs().add(1, 'day').hour(10).minute(0), 'none'),
});
const blankMember = () => ({ name: '', role: '', email: '', notes: '' });
const QUICK_FOLLOW = [
  { label: 'Tomorrow 10 AM', get: () => dayjs().add(1, 'day').hour(10).minute(0) },
  { label: 'In 2 days', get: () => dayjs().add(2, 'day').hour(10).minute(0) },
  { label: 'Next Monday', get: () => dayjs().add(1, 'week').day(1).hour(10).minute(0) },
  { label: 'In 1 week', get: () => dayjs().add(7, 'day').hour(10).minute(0) },
];

export default function Team() {
  const [members, setMembers] = useState([]);
  const [targets, setTargets] = useState([]);
  const [memberFilter, setMemberFilter] = useState('');
  const [scope, setScope] = useState('open');
  const [targetForm, setTargetForm] = useState(null);
  const [memberForm, setMemberForm] = useState(null);
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isMobile = useIsMobile();
  const [teamOpen, setTeamOpen] = useState(false); // phones: the member list is collapsed by default
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('new')) {
      setTargetForm(blankTarget(memberFilter ? [memberFilter] : []));
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params]);

  const load = useCallback(async () => {
    const [m, t] = await Promise.all([
      MembersApi.list(),
      TargetsApi.list({ includeClosed: scope === 'all' ? 'true' : undefined, member: memberFilter || undefined }),
    ]);
    setMembers(m);
    setTargets(t);
  }, [scope, memberFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(() => targets.find((t) => t._id === id), [targets, id]);
  // If the drawer is opened via deep link for a closed target not in current list, fetch it
  const [extra, setExtra] = useState(null);
  useEffect(() => {
    if (id && !selected) TargetsApi.get(id).then(setExtra).catch(() => navigate('/team'));
    else setExtra(null);
  }, [id, selected]);
  const current = selected || (extra && extra._id === id ? extra : null);

  const sorted = useMemo(() => {
    const rank = (t) => {
      if (!OPEN.includes(t.status)) return 3;
      if (t.followUpAt && isPast(t.followUpAt)) return 0;
      if (t.followUpAt && isToday(t.followUpAt)) return 1;
      return 2;
    };
    return [...targets].sort((a, b) => rank(a) - rank(b) || (a.followUpAt || '9') > (b.followUpAt || '9') ? 1 : -1);
  }, [targets]);

  const saveTarget = async () => {
    const { spec, ...rest } = targetForm;
    const { at, until } = specToPayload(spec);
    const payload = {
      ...rest,
      targetDate: targetForm.targetDate || null,
      followUpAt: at,
      followUpRepeat: spec.repeat,
      followUpUntil: until,
    };
    if (targetForm._id) {
      await TargetsApi.update(targetForm._id, payload);
      toast.success('Target updated');
    } else {
      await TargetsApi.create(payload);
      toast.success('Target added', at ? (spec.repeat === 'none' ? `Follow-up ${calendarDate(at)}` : describe(spec)) : 'No follow-up reminder');
    }
    setTargetForm(null);
    load();
  };
  const saveMember = async () => {
    if (memberForm._id) await MembersApi.update(memberForm._id, memberForm);
    else await MembersApi.create(memberForm);
    setMemberForm(null);
    toast.success('Team member saved');
    load();
  };
  const removeMember = async (m) => {
    if (!window.confirm(`Remove ${m.name} from your team?`)) return;
    await MembersApi.remove(m._id);
    if (memberFilter === m._id) setMemberFilter('');
    load();
  };
  const removeTarget = async (t) => {
    if (!window.confirm(`Delete target "${t.title}"?`)) return;
    await TargetsApi.remove(t._id);
    navigate('/team');
    load();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team & Targets</h1>
          <div className="sub">
            {members.length} members · {targets.filter((t) => OPEN.includes(t.status)).length} open targets
          </div>
        </div>
        <div className="page-actions">
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'all', label: 'All' },
            ]}
          />
          <button className="btn" onClick={() => setMemberForm(blankMember())}>
            + Member
          </button>
          <button className="btn btn-primary" onClick={() => setTargetForm(blankTarget(memberFilter ? [memberFilter] : []))}>
            + Target
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[280px_1fr] max-md:gap-3">
        <div className="card">
          <div className={`card-head ${isMobile ? 'cursor-pointer select-none' : ''}`} onClick={() => isMobile && setTeamOpen((o) => !o)}>
            <h3>
              {isMobile && <span className={`inline-block transition-transform ${teamOpen ? 'rotate-90' : ''}`}>›</span>} Team
              {isMobile && (
                <span className="muted small" style={{ fontWeight: 400 }}>
                  · {memberFilter ? members.find((m) => m._id === memberFilter)?.name || '…' : 'Everyone'}
                </span>
              )}
            </h3>
            {isMobile && <span className="muted xs">{members.length} members · tap to {teamOpen ? 'hide' : 'filter'}</span>}
          </div>
          <div className="card-body tight" style={isMobile && !teamOpen ? { display: 'none' } : undefined}>
            <div
              className={`member ${!memberFilter ? 'active' : ''}`}
              onClick={() => {
                setMemberFilter('');
                setTeamOpen(false);
              }}
            >
              <span className="avatar" style={{ background: '#334155' }}>
                ★
              </span>
              <div>
                <div className="nm">Everyone</div>
              </div>
            </div>
            {members.length === 0 && <div className="empty small">Add your team members to assign targets.</div>}
            {members.map((m) => (
              <div
                key={m._id}
                className={`member ${memberFilter === m._id ? 'active' : ''}`}
                onClick={() => {
                  setMemberFilter(m._id);
                  setTeamOpen(false);
                }}
              >
                <Avatar name={m.name} />
                <div className="grow ellipsis">
                  <div className="nm ellipsis">{m.name}</div>
                  {m.role && <div className="rl ellipsis">{m.role}</div>}
                </div>
                <div className="acts">
                  <button
                    className="btn btn-xs btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMemberForm({ ...m });
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="btn btn-xs btn-ghost btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeMember(m);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          {sorted.length === 0 && (
            <div className="card">
              <Empty icon="🎯" text="No targets here. Add a target for your team and set a follow-up time — WorkPA will remind you." />
            </div>
          )}
          <div className="targets-grid">
            {sorted.map((t) => {
              const due = OPEN.includes(t.status) && t.followUpAt && isPast(t.followUpAt);
              const todayF = OPEN.includes(t.status) && t.followUpAt && isToday(t.followUpAt) && !due;
              const last = t.followUps?.[t.followUps.length - 1];
              return (
                <div key={t._id} className={`target-card ${due ? 'due' : ''} ${todayF ? 'today' : ''}`} onClick={() => navigate(`/team/${t._id}`)}>
                  <div className="th">
                    <h3>{t.title}</h3>
                    <StatusBadge status={t.status} labels={TARGET_STATUS_LABEL} />
                  </div>
                  <div className="tm">
                    <div className="avatars">
                      {t.members?.map((m) => (
                        <Avatar key={m._id} name={m.name} />
                      ))}
                    </div>
                    {t.members?.length > 0 && <span>{t.members.map((m) => m.name.split(' ')[0]).join(', ')}</span>}
                    {t.targetDate && (
                      <span className={`badge ${isPast(dayjs(t.targetDate).endOf('day')) && OPEN.includes(t.status) ? 'badge-overdue' : 'badge-outline'}`}>
                        🎯 {fmtDate(t.targetDate, 'DD MMM')}
                      </span>
                    )}
                  </div>
                  {OPEN.includes(t.status) && (
                    <div className="tm">
                      {t.followUpAt ? (
                        <span className={`badge ${due ? 'badge-overdue' : todayF ? 'badge-soon' : 'badge-outline'}`}>
                          ⏰ Follow-up {calendarDate(t.snoozedUntil || t.followUpAt)}
                          {t.snoozedUntil && ' (snoozed)'}
                          {t.followUpRepeat !== 'none' && ` · ↻ ${scheduleLabel(t)}`}
                        </span>
                      ) : (
                        <span className="badge badge-outline">No follow-up scheduled</span>
                      )}
                    </div>
                  )}
                  {last && (
                    <div className="small muted mt ellipsis">
                      <span className={`badge badge-${last.outcome}`}>{OUTCOME_LABEL[last.outcome]}</span> {last.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {current && (
        <TargetDrawer
          target={current}
          members={members}
          onClose={() => navigate('/team')}
          onChange={load}
          onEdit={() =>
            setTargetForm({
              _id: current._id,
              title: current.title,
              description: current.description,
              status: current.status,
              priority: current.priority,
              members: (current.members || []).map((m) => m._id),
              targetDate: toDateInput(current.targetDate),
              spec: specFromDate(current.followUpAt, current.followUpRepeat, { until: current.followUpUntil }),
            })
          }
          onDelete={() => removeTarget(current)}
        />
      )}

      {targetForm && (
        <Modal
          title={targetForm._id ? 'Edit target' : 'New team target'}
          onClose={() => setTargetForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setTargetForm(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveTarget} disabled={!targetForm.title.trim() || (targetForm.spec.repeat !== 'none' && !specValid(targetForm.spec))}>
                {targetForm._id ? 'Save changes' : 'Add target'}
              </button>
            </>
          }
        >
          <label className="field">
            Target
            <input className="input" autoFocus value={targetForm.title} onChange={(e) => setTargetForm({ ...targetForm, title: e.target.value })} placeholder="e.g. Complete payment gateway integration" />
          </label>
          <label className="field">
            Details
            <textarea className="textarea" style={{ minHeight: 60 }} value={targetForm.description} onChange={(e) => setTargetForm({ ...targetForm, description: e.target.value })} />
          </label>
          <div className="field">
            Assigned to
            <div className="chips" style={{ marginTop: 4 }}>
              {members.length === 0 && <span className="muted small">No members yet — add them from the Team panel.</span>}
              {members.map((m) => {
                const on = targetForm.members.includes(m._id);
                return (
                  <button
                    type="button"
                    key={m._id}
                    className={`chip ${on ? 'active' : ''}`}
                    onClick={() =>
                      setTargetForm({ ...targetForm, members: on ? targetForm.members.filter((x) => x !== m._id) : [...targetForm.members, m._id] })
                    }
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              Target date
              <input className="input" type="date" value={targetForm.targetDate || ''} onChange={(e) => setTargetForm({ ...targetForm, targetDate: e.target.value })} />
            </label>
            <label className="field">
              Status
              <select className="select" value={targetForm.status} onChange={(e) => setTargetForm({ ...targetForm, status: e.target.value })}>
                {T_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TARGET_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Priority
              <select className="select" value={targetForm.priority} onChange={(e) => setTargetForm({ ...targetForm, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <div className="section-title" style={{ marginBottom: 0 }}>Follow-up reminder</div>
          <ScheduleFields spec={targetForm.spec} onChange={(spec) => setTargetForm({ ...targetForm, spec })} repeats={REPEATS} label="Remind me" quick={QUICK_FOLLOW} />
        </Modal>
      )}

      {memberForm && (
        <Modal
          title={memberForm._id ? 'Edit member' : 'Add team member'}
          onClose={() => setMemberForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setMemberForm(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveMember} disabled={!memberForm.name.trim()}>
                Save
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label className="field">
              Name
              <input className="input" autoFocus value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && memberForm.name.trim() && saveMember()} />
            </label>
            <label className="field">
              Role
              <input className="input" value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })} placeholder="Senior Developer" />
            </label>
            <label className="field full">
              Email (optional)
              <input className="input" value={memberForm.email} onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} />
            </label>
            <label className="field full">
              Notes (strengths, growth areas, anything to remember)
              <textarea className="textarea" style={{ minHeight: 60 }} value={memberForm.notes} onChange={(e) => setMemberForm({ ...memberForm, notes: e.target.value })} />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}

function TargetDrawer({ target, onClose, onChange, onEdit, onDelete }) {
  const empty = { text: '', outcome: 'info', next: '', status: '', stop: false };
  const [fu, setFu] = useState(empty);
  const toast = useToast();
  const repeating = ['daily', 'weekly'].includes(target.followUpRepeat) && target.followUpAt;

  useEffect(() => {
    setFu(empty);
  }, [target._id]);

  const logFollowUp = async (e) => {
    e?.preventDefault();
    if (!fu.text.trim()) return;
    await TargetsApi.addFollowUp(target._id, {
      text: fu.text.trim(),
      outcome: fu.outcome,
      nextFollowUpAt: !repeating && fu.next ? new Date(fu.next).toISOString() : undefined,
      clearFollowUp: !repeating && !fu.next && !!target.followUpAt,
      stopRepeating: repeating && fu.stop,
      status: fu.status || undefined,
    });
    toast.success('Follow-up logged', !repeating && fu.next ? `Next: ${calendarDate(fu.next)}` : repeating && fu.stop ? 'Repeating reminder stopped' : '');
    setFu(empty);
    onChange();
  };
  const setStatus = async (s) => {
    await TargetsApi.setStatus(target._id, s);
    onChange();
  };
  const snooze = async (minutes) => {
    await TargetsApi.snooze(target._id, minutes);
    toast.success('Follow-up snoozed', repeating ? 'Only this occurrence — the schedule is unchanged' : '');
    onChange();
  };
  const removeFollowUp = async (f) => {
    if (!window.confirm('Delete this follow-up entry?')) return;
    await TargetsApi.removeFollowUp(target._id, f._id);
    onChange();
  };

  const log = [...(target.followUps || [])].reverse();
  const open = OPEN.includes(target.status);

  return (
    <Drawer
      onClose={onClose}
      title={
        <div>
          <div className="row wrap">
            <StatusBadge status={target.status} labels={TARGET_STATUS_LABEL} />
            <span className={`badge badge-${target.priority}`}>{target.priority}</span>
          </div>
          <h2 style={{ marginTop: 6 }}>{target.title}</h2>
        </div>
      }
      actions={
        <>
          <button className="btn btn-sm" onClick={onEdit}>
            Edit
          </button>
          <button className="btn btn-sm btn-danger" onClick={onDelete}>
            Delete
          </button>
        </>
      }
    >
      <div className="row wrap">
        {target.members?.map((m) => (
          <span key={m._id} className="row" style={{ gap: 6 }}>
            <Avatar name={m.name} size={24} />
            <span className="small">
              {m.name}
              {m.role && <span className="muted"> · {m.role}</span>}
            </span>
          </span>
        ))}
        {(!target.members || target.members.length === 0) && <span className="muted small">Not assigned to anyone</span>}
      </div>

      <div className="row wrap small">
        {target.targetDate && (
          <span className={`badge ${isPast(dayjs(target.targetDate).endOf('day')) && open ? 'badge-overdue' : 'badge-outline'}`}>🎯 Target {fmtDate(target.targetDate)}</span>
        )}
        {open && target.followUpAt && (
          <span className={`badge ${isPast(target.snoozedUntil || target.followUpAt) ? 'badge-overdue' : 'badge-soon'}`}>
            ⏰ Follow-up {calendarDate(target.snoozedUntil || target.followUpAt)}
            {target.snoozedUntil && ' (snoozed)'}
            {repeating && ` · ↻ ${scheduleLabel(target)}`}
          </span>
        )}
        {open && target.followUpAt && (
          <>
            <button className="btn btn-xs" onClick={() => snooze(60 * 3)}>
              Snooze 3h
            </button>
            <button className="btn btn-xs" onClick={() => snooze(60 * 24)}>
              Tomorrow
            </button>
          </>
        )}
      </div>

      <div>
        <div className="section-title">Status</div>
        <div className="segmented">
          {T_STATUSES.map((s) => (
            <button key={s} className={target.status === s ? 'active' : ''} onClick={() => setStatus(s)}>
              {TARGET_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {target.description && (
        <div>
          <div className="section-title">Details</div>
          <div className="pre">{target.description}</div>
        </div>
      )}

      <div>
        <div className="section-title">Log a follow-up</div>
        <form onSubmit={logFollowUp} className="col">
          <textarea
            className="textarea"
            style={{ minHeight: 64 }}
            placeholder="What did they say? Where are they? Any blockers?"
            value={fu.text}
            onChange={(e) => setFu({ ...fu, text: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && logFollowUp(e)}
          />
          <div className="form-grid">
            <label className="field">
              Outcome
              <select className="select" value={fu.outcome} onChange={(e) => setFu({ ...fu, outcome: e.target.value })}>
                {Object.entries(OUTCOME_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Update status (optional)
              <select className="select" value={fu.status} onChange={(e) => setFu({ ...fu, status: e.target.value })}>
                <option value="">Keep {TARGET_STATUS_LABEL[target.status]}</option>
                {T_STATUSES.filter((s) => s !== target.status).map((s) => (
                  <option key={s} value={s}>
                    {TARGET_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            {repeating ? (
              <div className="field full">
                Next follow-up reminder
                <div className="small" style={{ marginTop: 4 }}>
                  ↻ {scheduleLabel(target)} — next on <b>{calendarDate(target.followUpAt)}</b> (automatic)
                </div>
                <label className="checkbox small" style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={fu.stop} onChange={(e) => setFu({ ...fu, stop: e.target.checked })} /> Stop the repeating reminder after this follow-up
                </label>
              </div>
            ) : (
              <label className="field full">
                Next follow-up reminder {target.followUpAt && <span className="muted">(leave empty to clear the current one)</span>}
                <input className="input" type="datetime-local" value={fu.next} onChange={(e) => setFu({ ...fu, next: e.target.value })} />
              </label>
            )}
          </div>
          {!repeating && (
            <div className="chips">
              {QUICK_FOLLOW.map((qf) => (
                <button type="button" key={qf.label} className="chip" onClick={() => setFu({ ...fu, next: toLocalInput(qf.get()) })}>
                  ⏰ {qf.label}
                </button>
              ))}
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" disabled={!fu.text.trim()}>
              Log follow-up
            </button>
          </div>
        </form>
      </div>

      <div>
        <div className="section-title">Follow-up history ({log.length})</div>
        {log.length === 0 && <div className="muted small">No follow-ups logged yet.</div>}
        <div className="timeline">
          {log.map((f) => (
            <div key={f._id} className="tl-item">
              <div className="tl-dot" style={{ background: f.outcome === 'blocked' ? 'var(--danger)' : f.outcome === 'atrisk' ? 'var(--warn)' : f.outcome === 'ontrack' ? 'var(--success)' : 'var(--muted)' }} />
              <div className="tl-body">
                <div className="when">
                  <span>
                    {fmtDateTime(f.createdAt)} · <span className={`badge badge-${f.outcome}`}>{OUTCOME_LABEL[f.outcome]}</span>
                  </span>
                  <span className="actions">
                    <button className="btn btn-xs btn-ghost btn-danger" onClick={() => removeFollowUp(f)}>
                      ✕
                    </button>
                  </span>
                </div>
                <div className="pre">{f.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}
