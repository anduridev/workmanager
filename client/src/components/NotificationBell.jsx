import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fromNow } from '../lib/date';
import { Targets, Reminders, Notifications, Push } from '../lib/api';
import { useToast } from './Toast';
import Modal from './Modal';
import { BellIcon, DownloadIcon, FlagIcon, CheckSquareIcon, ClockIcon, SunIcon, WalletIcon } from './icons';

const ICON = { target: <FlagIcon size={16} />, task: <CheckSquareIcon size={16} />, reminder: <ClockIcon size={16} />, todo: <SunIcon size={16} />, expense: <WalletIcon size={16} />, system: 'ℹ' };

export default function NotificationBell({ notif, onInstallHelp, standalone }) {
  const [open, setOpen] = useState(false);
  const [digest, setDigest] = useState(null);
  const ref = useRef(null);
  const navigate = useNavigate();
  const toast = useToast();
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

  const showDigest = async () => {
    setOpen(false);
    try {
      setDigest(await Notifications.digestPreview());
    } catch (e) {
      toast.error(e.message);
    }
  };

  useEffect(() => {
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, []);

  const openRef = (n) => {
    notif.markRead(n._id);
    setOpen(false);
    if (n.link) navigate(n.link);
    else if (n.refType === 'Target') navigate(`/team/${n.refId}`);
    else if (n.refType === 'Task') navigate(`/tasks/${n.refId}`);
    else if (n.refType === 'DailyTodo') navigate('/today');
    else navigate('/reminders');
  };

  const snooze = async (n, minutes) => {
    try {
      if (n.refType === 'Target') await Targets.snooze(n.refId, minutes);
      else if (n.refType === 'Reminder') await Reminders.snooze(n.refId, minutes);
      await notif.remove(n._id);
      toast.success(`Snoozed for ${minutes >= 60 ? minutes / 60 + 'h' : minutes + 'm'}`);
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn btn-icon relative"
        onClick={() => {
          setOpen((o) => !o);
          notif.requestPermission();
        }}
        title="Notifications"
        aria-label="Notifications"
      >
        <BellIcon size={19} />
        {notif.unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {notif.unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-[calc(60px+env(safe-area-inset-top))] z-[60] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop animate-pop md:absolute md:inset-x-auto md:right-0 md:top-12 md:w-[400px]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 font-semibold">
            <span>Notifications</span>
            <div className="flex items-center gap-2">
              {notif.unreadCount > 0 && (
                <button className="btn btn-xs" onClick={notif.markAllRead}>
                  Mark all read
                </button>
              )}
              <button className="btn btn-xs btn-ghost" onClick={notif.clearRead} title="Remove read notifications">
                Clear
              </button>
            </div>
          </div>
          <div className={`flex gap-3 border-b border-slate-200 px-4 py-3 ${notif.push.enabled ? 'bg-emerald-50/60' : 'bg-amber-50/60'}`}>
            <span className="mt-0.5 text-base">{notif.push.enabled ? '📲' : '🔕'}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{notif.push.enabled ? 'Push notifications are on for this device' : 'Get reminders on this device'}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {notif.push.supported
                  ? notif.push.enabled
                    ? 'Reminders, follow-ups and the morning digest arrive even when the app is closed.'
                    : 'Works when the app is closed too. On iPhone, add WorkPA to the Home Screen first.'
                  : 'This browser does not support push notifications (on iPhone, add WorkPA to the Home Screen and open it from there).'}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {notif.push.supported && (
                  <button className={`btn btn-xs ${notif.push.enabled ? '' : 'btn-primary'}`} onClick={notif.togglePush} disabled={notif.push.busy}>
                    {notif.push.busy ? '…' : notif.push.enabled ? 'Turn off' : 'Enable push'}
                  </button>
                )}
                {!standalone && onInstallHelp && (
                  <button
                    className="btn btn-xs"
                    onClick={() => {
                      setOpen(false);
                      onInstallHelp();
                    }}
                  >
                    <DownloadIcon size={14} /> Add to home screen
                  </button>
                )}
                {notif.push.enabled && (
                  <button className="btn btn-xs" onClick={() => Push.test().then(() => toast.success('Test push sent')).catch((e) => toast.error(e.message))}>
                    Send test
                  </button>
                )}
                <button className="btn btn-xs btn-ghost" onClick={showDigest}>
                  ☀ Today's digest
                </button>
              </div>
            </div>
          </div>
          {permission === 'default' && !notif.push.supported && (
            <div className="flex gap-3 border-b border-slate-200 bg-amber-50/60 px-4 py-3">
              <span className="text-base">🔔</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">Enable browser notifications</div>
                <div className="mt-2">
                  <button className="btn btn-xs btn-primary" onClick={() => Notification.requestPermission()}>
                    Enable
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="max-h-[58dvh] overflow-y-auto md:max-h-[440px]">
            {notif.items.length === 0 && <div className="empty">No notifications yet</div>}
            {notif.items.map((n) => (
              <div key={n._id} className={`flex gap-3 border-b border-slate-100 px-4 py-3 last:border-0 ${n.read ? '' : 'bg-primary-50/50'}`}>
                <span className="mt-0.5 text-slate-400">{ICON[n.kind] || 'ℹ'}</span>
                <div className="min-w-0 flex-1">
                  <div className="cursor-pointer text-[13px] font-semibold hover:text-primary-700" onClick={() => openRef(n)}>
                    {n.title}
                  </div>
                  {n.body && <div className="mt-0.5 text-xs text-slate-500">{n.body}</div>}
                  <div className="mt-0.5 text-xs text-slate-400">{fromNow(n.createdAt)}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {!n.read && (
                      <button className="btn btn-xs" onClick={() => notif.markRead(n._id)}>
                        Read
                      </button>
                    )}
                    {(n.refType === 'Target' || n.refType === 'Reminder') && (
                      <>
                        <button className="btn btn-xs" onClick={() => snooze(n, 30)}>
                          Snooze 30m
                        </button>
                        <button className="btn btn-xs" onClick={() => snooze(n, 180)}>
                          3h
                        </button>
                        <button className="btn btn-xs" onClick={() => snooze(n, 24 * 60)}>
                          Tomorrow
                        </button>
                      </>
                    )}
                    <button className="btn btn-xs btn-ghost" onClick={() => notif.remove(n._id)}>
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {digest && (
        <Modal
          title={digest.title}
          onClose={() => setDigest(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDigest(null)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() =>
                  Notifications.sendDigest()
                    .then(() => {
                      toast.success('Digest sent to your devices');
                      setDigest(null);
                      notif.refresh();
                    })
                    .catch((e) => toast.error(e.message))
                }
              >
                Send to my devices now
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-1.5">
            {digest.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
          <div className="text-[13px] text-slate-500">This is what the morning digest sends automatically at 9:00 on weekdays (in-app + push).</div>
        </Modal>
      )}
    </div>
  );
}
