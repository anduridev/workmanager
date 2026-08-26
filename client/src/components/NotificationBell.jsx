import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fromNow } from '../lib/date';
import { Targets, Reminders, Notifications, Push } from '../lib/api';
import { useToast } from './Toast';
import Modal from './Modal';

const ICON = { target: '⚑', task: '☑', reminder: '⏰', todo: '☀', system: 'ℹ' };

export default function NotificationBell({ notif }) {
  const [open, setOpen] = useState(false);
  const [digest, setDigest] = useState(null);
  const ref = useRef(null);
  const showDigest = async () => {
    setOpen(false);
    try {
      setDigest(await Notifications.digestPreview());
    } catch (e) {
      toast.error(e.message);
    }
  };
  const navigate = useNavigate();
  const toast = useToast();
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

  useEffect(() => {
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
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
    <div className="bell" ref={ref}>
      <button
        className="btn btn-icon"
        onClick={() => {
          setOpen((o) => !o);
          notif.requestPermission();
        }}
        title="Notifications"
      >
        🔔
        {notif.unreadCount > 0 && <span className="dot">{notif.unreadCount}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="ph">
            <span>Notifications</span>
            <div className="row">
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
          <div className="notif" style={{ background: notif.push.enabled ? '#f0fdf4' : '#fffbeb' }}>
            <span className="ic">{notif.push.enabled ? '📲' : '🔕'}</span>
            <div className="nb">
              <div className="nt">{notif.push.enabled ? 'Push notifications are on for this device' : 'Get reminders on this device'}</div>
              <div className="nd">
                {notif.push.supported
                  ? notif.push.enabled
                    ? 'Reminders, follow-ups and the morning digest arrive even when the app is closed.'
                    : 'Works when the app is closed too. On iPhone, add WorkPA to the Home Screen first.'
                  : 'This browser does not support push notifications (on iPhone, add WorkPA to the Home Screen and open it from there).'}
              </div>
              <div className="na">
                {notif.push.supported && (
                  <button className={`btn btn-xs ${notif.push.enabled ? '' : 'btn-primary'}`} onClick={notif.togglePush} disabled={notif.push.busy}>
                    {notif.push.busy ? '…' : notif.push.enabled ? 'Turn off' : 'Enable push'}
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
            <div className="notif" style={{ background: '#fffbeb' }}>
              <span className="ic">🔔</span>
              <div className="nb">
                <div className="nt">Enable browser notifications</div>
                <div className="na">
                  <button className="btn btn-xs btn-primary" onClick={() => Notification.requestPermission()}>
                    Enable
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="notif-list">
            {notif.items.length === 0 && <div className="empty">No notifications yet</div>}
            {notif.items.map((n) => (
              <div key={n._id} className={`notif ${n.read ? '' : 'unread'}`}>
                <span className="ic">{ICON[n.kind] || 'ℹ'}</span>
                <div className="nb">
                  <div className="nt clickable" onClick={() => openRef(n)}>
                    {n.title}
                  </div>
                  {n.body && <div className="nd">{n.body}</div>}
                  <div className="nd">{fromNow(n.createdAt)}</div>
                  <div className="na">
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
          <div className="col" style={{ gap: 6 }}>
            {digest.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
          <div className="small muted">This is what the morning digest sends automatically at 9:00 on weekdays (in-app + push).</div>
        </Modal>
      )}
    </div>
  );
}
