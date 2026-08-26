import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fromNow } from '../lib/date';
import { Targets, Reminders } from '../lib/api';
import { useToast } from './Toast';

const ICON = { target: '⚑', task: '☑', reminder: '⏰', todo: '☀', system: 'ℹ' };

export default function NotificationBell({ notif }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
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
          {permission === 'default' && (
            <div className="notif" style={{ background: '#fffbeb' }}>
              <span className="ic">🔕</span>
              <div className="nb">
                <div className="nt">Enable browser notifications</div>
                <div className="nd">So reminders reach you even when this tab is in the background.</div>
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
    </div>
  );
}
