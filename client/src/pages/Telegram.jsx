import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Telegram as Api } from '../lib/api';
import { dayjs, fmtDate } from '../lib/date';
import { Empty } from '../components/ui';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { useIsMobile } from '../lib/useMedia';
import { RefreshIcon, PlaneIcon } from '../components/icons';

const POLL_MS = 8000;
const MEDIA_INLINE_MAX = 20 * 1024 * 1024;
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** Media inside a bubble: photos/images inline, voice/audio/video playable, other files as a download chip. */
function MediaView({ chat, m }) {
  const media = m.media;
  const inline = ['photo', 'image', 'voice', 'audio'].includes(media.kind) || (media.kind === 'video' && media.size < MEDIA_INLINE_MAX);
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (!inline) return;
    let alive = true;
    let obj;
    Api.media(chat, m.id)
      .then((blob) => {
        if (!alive) return;
        obj = URL.createObjectURL(blob);
        setUrl(obj);
      })
      .catch(() => alive && setErr('could not load — open Telegram'));
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [chat, m.id, inline]);
  const download = async () => {
    if (media.size > MEDIA_INLINE_MAX) return toast.error(`File is ${fmtSize(media.size)}`, 'Too big to fetch here — open it in Telegram');
    try {
      const blob = await Api.media(chat, m.id);
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = media.filename || `file-${m.id}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
    } catch (e) {
      toast.error(e.message);
    }
  };
  if (err) return <div className="mb-1 rounded-lg bg-black/5 px-2 py-1.5 text-[12px]">📎 {media.filename || 'Attachment'} — {err}</div>;
  if (media.kind === 'photo' || media.kind === 'image')
    return url ? (
      <img src={url} alt={media.filename || 'photo'} className="mb-1 max-h-[280px] max-w-full cursor-zoom-in rounded-lg" onClick={() => window.open(url, '_blank')} />
    ) : (
      <div className="mb-1 grid h-[150px] w-[220px] max-w-full animate-pulse place-items-center rounded-lg bg-black/10 text-[12px]">Loading photo…</div>
    );
  if (media.kind === 'voice' || media.kind === 'audio') return url ? <audio controls src={url} className="mb-1 h-10 max-w-full" /> : <div className="mb-1 text-[12px]">Loading audio…</div>;
  if (media.kind === 'video' && inline)
    return url ? <video controls src={url} className="mb-1 max-h-[280px] max-w-full rounded-lg" /> : <div className="mb-1 grid h-[150px] w-[220px] max-w-full animate-pulse place-items-center rounded-lg bg-black/10 text-[12px]">Loading video…</div>;
  return (
    <button className="mb-1 flex w-full items-center gap-2 rounded-lg bg-black/10 px-2 py-1.5 text-left text-[12px] hover:bg-black/20" onClick={download} title="Download">
      <span className="text-base">📄</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{media.filename || 'Attachment'}</span>
        <span className="opacity-70">{media.size ? fmtSize(media.size) : media.mime || 'file'}</span>
      </span>
      <span className="underline">Download</span>
    </button>
  );
}

/** Sign in with the support account: phone -> code -> (2FA password). */
function SignIn({ status, onDone }) {
  const [step, setStep] = useState('phone'); // phone | code | password
  const [phone, setPhone] = useState(status?.pendingPhone || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const start = async () => {
    setBusy(true);
    try {
      await Api.loginStart(phone.trim());
      setStep('code');
      toast.success('Code sent', 'Check the Telegram app (or SMS) on the support phone');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const complete = async (withPassword) => {
    setBusy(true);
    try {
      const r = await Api.loginComplete(code.trim(), withPassword ? password : undefined);
      if (r.needPassword) {
        setStep('password');
        return;
      }
      toast.success('Signed in to Telegram');
      onDone();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mx-auto max-w-md">
      <div className="row items-center gap-2">
        <PlaneIcon size={18} className="text-primary-600" />
        <h2 className="text-[15px] font-semibold">Sign in with your support Telegram account</h2>
      </div>
      <p className="muted mt-1 text-[13px]">Replies you send from here appear in the group from this account — exactly like replying from the Telegram app.</p>
      {step === 'phone' && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="field">
            Phone number (with country code)
            <input className="input" placeholder="+91 98…" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && phone.trim() && start()} />
          </label>
          <button className="btn btn-primary" onClick={start} disabled={busy || !phone.trim()}>
            {busy ? 'Sending…' : 'Send login code'}
          </button>
        </div>
      )}
      {step === 'code' && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="field">
            Login code (sent to {phone})
            <input className="input" autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code.trim() && complete(false)} />
          </label>
          <div className="row gap-2">
            <button className="btn" onClick={() => setStep('phone')}>Back</button>
            <button className="btn btn-primary grow" onClick={() => complete(false)} disabled={busy || !code.trim()}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </div>
        </div>
      )}
      {step === 'password' && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="field">
            Two-step verification password
            <input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && password && complete(true)} />
          </label>
          <button className="btn btn-primary" onClick={() => complete(true)} disabled={busy || !password}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Pick one of the account's groups to link to a client. */
function LinkModal({ client, onClose, onLinked }) {
  const [dialogs, setDialogs] = useState(null);
  const [q, setQ] = useState('');
  const toast = useToast();
  useEffect(() => {
    Api.dialogs().then(setDialogs).catch((e) => toast.error(e.message));
  }, []);
  const list = (dialogs || []).filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase()));
  const link = async (d) => {
    try {
      await Api.updateClient(client._id, { chatId: d.id, chatTitle: d.title, chatUsername: d.username || '' });
      toast.success(`${client.name} linked`, d.title);
      onLinked();
    } catch (e) {
      toast.error(e.message);
    }
  };
  return (
    <Modal title={`Link a Telegram group — ${client.name}`} onClose={onClose}>
      <input className="input input-sm mb-2" type="search" placeholder="Search your groups…" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
      {dialogs === null && <div className="muted p-3 text-[13px]">Loading your groups…</div>}
      {dialogs !== null && list.length === 0 && <div className="muted p-3 text-[13px]">No groups match.</div>}
      <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
        {list.map((d) => (
          <button key={d.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-primary-300 hover:bg-primary-50/40" onClick={() => link(d)}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-100 text-[13px] font-bold text-primary-700">{d.title.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{d.title}</span>
              <span className="block truncate text-[12px] text-slate-500">
                {d.members ? `${d.members} members · ` : ''}
                {d.lastMessage?.text || ''}
              </span>
            </span>
            {d.unreadCount > 0 && <span className="badge bg-primary-100 text-primary-700">{d.unreadCount}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export default function Telegram() {
  const [status, setStatus] = useState(null);
  const [clients, setClients] = useState(null);
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null); // message being replied to
  const [linkFor, setLinkFor] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isMobile = useIsMobile();
  const bottomRef = useRef(null);

  const selectedId = params.get('c') || '';
  const selected = useMemo(() => (clients || []).find((c) => c._id === selectedId), [clients, selectedId]);

  const loadStatus = useCallback(() => Api.status().then(setStatus).catch((e) => setStatus({ configured: true, signedIn: false, error: e.message })), []);
  const loadClients = useCallback(() => Api.clients().then(setClients).catch((e) => toast.error(e.message)), []);
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);
  useEffect(() => {
    if (status?.signedIn || status?.configured) loadClients();
  }, [status?.signedIn, loadClients]);

  // chat: load + poll while open
  const loadMessages = useCallback(async () => {
    if (!selected?.chatId || !status?.signedIn) return;
    try {
      const list = await Api.messages(selected.chatId);
      setMessages(list);
    } catch (e) {
      toast.error(e.message);
    }
  }, [selected?.chatId, status?.signedIn]);
  useEffect(() => {
    setMessages(null);
    setReplyTo(null);
    if (!selected?.chatId) return;
    loadMessages();
    const t = setInterval(loadMessages, POLL_MS);
    return () => clearInterval(t);
  }, [selected?.chatId, loadMessages]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length, messages?.[messages?.length - 1]?.id]);

  const pick = (c) => {
    const next = new URLSearchParams(params);
    if (c) next.set('c', c._id);
    else next.delete('c');
    setParams(next, { replace: false });
  };

  const addClient = async () => {
    if (!newName.trim()) return;
    try {
      await Api.addClient(newName.trim());
      setNewName('');
      loadClients();
    } catch (e) {
      toast.error(e.message);
    }
  };
  const unlink = async (c) => {
    await Api.updateClient(c._id, { chatId: '', chatTitle: '', chatUsername: '' });
    loadClients();
  };
  const removeClient = async (c) => {
    if (!window.confirm(`Remove client "${c.name}" from this list? (The Telegram group itself is untouched.)`)) return;
    await Api.removeClient(c._id);
    if (selectedId === c._id) pick(null);
    loadClients();
  };

  const send = async () => {
    if (!text.trim() || !selected?.chatId) return;
    setBusy(true);
    try {
      const m = await Api.send(selected.chatId, text.trim(), replyTo?.id || null);
      setMessages((l) => [...(l || []), m]);
      setText('');
      setReplyTo(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const msgById = (id) => (messages || []).find((m) => m.id === id);
  const taskFromMessage = (m) => navigate(`/tasks?new=1&title=${encodeURIComponent(`[${selected.name}] ${m.text.slice(0, 120)}`)}`);

  if (status && !status.configured)
    return (
      <div className="card mx-auto max-w-xl">
        <h1 className="mb-2">Telegram</h1>
        <p className="muted mb-3">Not configured yet. Get API credentials for your support account at <b>my.telegram.org → API development tools</b>, then add to Railway → Variables and redeploy:</p>
        <pre className="rounded-lg bg-slate-50 p-3 text-[13px] leading-6">{`TELEGRAM_API_ID   = 1234567
TELEGRAM_API_HASH = ...`}</pre>
        <p className="muted mt-3 text-[13px]">After that you sign in here once with the support account's phone number + login code; the session is stored encrypted.</p>
      </div>
    );

  const clientList = (
    <div className={`card !p-0 ${isMobile ? '' : 'flex h-full w-[320px] shrink-0 flex-col'}`}>
      <div className="border-b border-slate-100 p-3">
        <div className="row gap-2">
          <input className="input input-sm grow" placeholder="Add client (e.g. Paybitz)…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addClient()} />
          <button className="btn btn-sm btn-primary" onClick={addClient} disabled={!newName.trim()}>
            Add
          </button>
        </div>
      </div>
      {clients === null && <div className="muted p-4 text-[13px]">Loading clients…</div>}
      {clients !== null && clients.length === 0 && <div className="p-4"><Empty icon="👥" text="No clients yet — add Paybitz, Global Bridge, …" /></div>}
      <div className={`flex flex-col ${isMobile ? '' : 'min-h-0 flex-1 overflow-y-auto'}`}>
        {(clients || []).map((c) => (
          <div key={c._id} className={`flex cursor-pointer items-center gap-3 border-b border-slate-50 px-3 py-2.5 hover:bg-slate-50 ${selectedId === c._id ? 'bg-primary-50/60' : ''}`} onClick={() => pick(c)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-[13px] font-bold text-white">{c.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="row items-center gap-2">
                <b className="truncate text-[13px]">{c.name}</b>
                {c.unreadCount > 0 && <span className="badge bg-primary-600 text-white">{c.unreadCount}</span>}
              </span>
              <span className="block truncate text-[12px] text-slate-500">
                {c.chatId ? c.lastMessage?.text || c.chatTitle : 'No group linked yet'}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {c.chatId && c.lastMessage?.date && <span className="text-[11px] text-slate-400">{dayjs(c.lastMessage.date).fromNow(true)}</span>}
              <button
                className="btn btn-xs btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setLinkFor(c);
                }}
              >
                {c.chatId ? 'Change' : 'Link group'}
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const chat = selected && (
    <div className={isMobile ? 'fixed inset-0 z-50 flex flex-col bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]' : 'card flex h-full min-h-0 flex-1 flex-col !p-0'}>
      <div className="row items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        {isMobile && (
          <button className="btn btn-xs" onClick={() => pick(null)}>
            ←
          </button>
        )}
        <b className="text-[14px]">{selected.name}</b>
        <span className="muted truncate text-[12px]">{selected.chatTitle}</span>
        <span className="ml-auto row items-center gap-1">
          {selected.chatUsername && (
            <a className="btn btn-xs" href={`https://t.me/${selected.chatUsername}`} target="_blank" rel="noreferrer">
              Open in Telegram
            </a>
          )}
          <button className="btn btn-xs" onClick={loadMessages} title="Refresh">
            <RefreshIcon size={14} />
          </button>
          <button className="btn btn-xs btn-ghost" onClick={() => unlink(selected)} title="Unlink this group from the client">
            Unlink
          </button>
          <button className="btn btn-xs btn-ghost text-red-600" onClick={() => removeClient(selected)}>
            Remove
          </button>
        </span>
      </div>

      {!selected.chatId && (
        <div className="grid flex-1 place-items-center p-6">
          <div className="text-center">
            <Empty icon="🔗" text="No Telegram group linked to this client yet." />
            <button className="btn btn-primary mt-2" onClick={() => setLinkFor(selected)}>
              Link a group
            </button>
          </div>
        </div>
      )}

      {selected.chatId && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {messages === null && <div className="muted text-[13px]">Loading messages…</div>}
            {messages !== null && messages.length === 0 && <Empty icon="💬" text="No messages yet." />}
            {(messages || []).map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || !dayjs(prev.date).isSame(m.date, 'day');
              const quoted = m.replyToId ? msgById(m.replyToId) : null;
              return (
                <div key={m.id}>
                  {newDay && <div className="my-2 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">{fmtDate(m.date, 'DD MMM YYYY')}</div>}
                  <div className={`group mb-1.5 flex ${m.out ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${m.out ? 'rounded-br-md bg-primary-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-800'}`}>
                      {!m.out && <div className="mb-0.5 text-[11px] font-semibold text-primary-700">{m.sender}</div>}
                      {quoted && (
                        <div className={`mb-1 border-l-2 pl-2 text-[12px] ${m.out ? 'border-white/50 text-white/85' : 'border-primary-300 text-slate-500'}`}>
                          <b>{quoted.sender}:</b> {quoted.text.slice(0, 80)}
                        </div>
                      )}
                      {m.media && <MediaView chat={selected.chatId} m={m} />}
                      <span className="whitespace-pre-wrap break-words">{m.text}</span>
                      <div className={`mt-0.5 flex items-center gap-2 text-[10px] ${m.out ? 'text-white/70' : 'text-slate-400'}`}>
                        {dayjs(m.date).format('HH:mm')}
                        {!m.out && (
                          <span className="hidden gap-1.5 group-hover:inline-flex">
                            <button className="underline" onClick={() => setReplyTo(m)}>
                              Reply
                            </button>
                            <button className="underline" onClick={() => taskFromMessage(m)} title="Create a WorkPA task from this message">
                              Task
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-slate-100 p-3">
            {replyTo && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-[12px] text-slate-600">
                Replying to <b>{replyTo.sender}</b>: <span className="min-w-0 flex-1 truncate">{replyTo.text.slice(0, 80)}</span>
                <button className="close !h-6 !w-6" onClick={() => setReplyTo(null)}>
                  ×
                </button>
              </div>
            )}
            <div className="row gap-2">
              <textarea
                className="textarea grow !min-h-[42px]"
                rows={1}
                placeholder={`Message ${selected.chatTitle || selected.name}… (Enter to send, Shift+Enter for a new line)`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button className="btn btn-primary self-end" onClick={send} disabled={busy || !text.trim()}>
                {busy ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Telegram</h1>
          <div className="sub">
            {status === null && 'Connecting…'}
            {status?.signedIn && (
              <>
                Signed in as <b>{status.me?.name}</b>
                {status.me?.username ? ` (@${status.me.username})` : ''} — replies go out from this account
              </>
            )}
            {status && status.configured && !status.signedIn && (status.error || 'Sign in with the support account to read and reply')}
          </div>
        </div>
        {status?.signedIn && (
          <div className="row wrap">
            <button className="btn btn-sm" onClick={() => { loadClients(); loadMessages(); }}>
              <RefreshIcon /> Refresh
            </button>
            {status.canManage && (
              <button className="btn btn-sm btn-ghost" onClick={async () => { await Api.logout(); loadStatus(); }}>
                Sign out of Telegram
              </button>
            )}
          </div>
        )}
      </div>

      {status && status.configured && !status.signedIn && status.canManage && <SignIn status={status} onDone={loadStatus} />}
      {status && status.configured && !status.signedIn && !status.canManage && (
        <div className="card mx-auto max-w-md text-center">
          <Empty icon="🔐" text="The support Telegram account is not signed in yet — ask the admin to sign in once from this screen." />
        </div>
      )}

      {status?.signedIn && (
        <div className={isMobile ? '' : 'flex items-stretch gap-4'} style={isMobile ? undefined : { height: 'calc(100dvh - 248px)', minHeight: 360 }}>
          {(!isMobile || !selected) && clientList}
          {(!isMobile || selected) && (chat || (!isMobile && (
            <div className="card grid h-full flex-1 place-items-center">
              <Empty icon="💬" text="Pick a client on the left to open its group chat." />
            </div>
          )))}
        </div>
      )}

      {linkFor && (
        <LinkModal
          client={linkFor}
          onClose={() => setLinkFor(null)}
          onLinked={() => {
            setLinkFor(null);
            loadClients();
          }}
        />
      )}
    </>
  );
}
