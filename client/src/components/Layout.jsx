import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { dayjs } from '../lib/date';
import { Auth } from '../lib/api';
import NotificationBell from './NotificationBell';
import Modal from './Modal';
import { useNotifications } from './useNotifications';
import { useToast } from './Toast';

const NAV = [
  { to: '/', label: 'Dashboard', ico: '◈', end: true },
  { to: '/today', label: 'Today', ico: '☀' },
  { to: '/projects', label: 'Projects', ico: '▤' },
  { to: '/tasks', label: 'My Tasks', ico: '☑' },
  { to: '/notes', label: 'Notes', ico: '✎' },
  { to: '/team', label: 'Team & Targets', ico: '⚑' },
  { to: '/reminders', label: 'Reminders', ico: '⏰' },
];

export default function Layout({ children, user, onLogout }) {
  const notif = useNotifications();
  const navigate = useNavigate();
  const toast = useToast();
  const [pw, setPw] = useState(null); // {current, next, confirm}

  const changePassword = async () => {
    if (pw.next !== pw.confirm) return toast.error('New passwords do not match');
    try {
      await Auth.changePassword(pw.current, pw.next);
      toast.success('Password changed');
      setPw(null);
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">✓</div>
          <span>
            WorkPA
            <small>Your personal assistant</small>
          </span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="ico">{n.ico}</span>
              <span className="lbl">{n.label}</span>
              {n.to === '/reminders' && notif.unreadCount > 0 && <span className="count">{notif.unreadCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="ver">Signed in as <b>{user?.displayName || user?.username}</b></span>
          <button onClick={() => setPw({ current: '', next: '', confirm: '' })}>Change password</button>
          <button onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="date">{dayjs().format('dddd, DD MMMM YYYY')}</div>
          <div className="topbar-actions">
            <button className="btn btn-sm" onClick={() => navigate('/tasks?new=1')}>
              + Task
            </button>
            <button className="btn btn-sm" onClick={() => navigate('/reminders?new=1')}>
              + Reminder
            </button>
            <NotificationBell notif={notif} />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      {pw && (
        <Modal
          title="Change password"
          onClose={() => setPw(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPw(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={changePassword} disabled={!pw.current || pw.next.length < 6}>
                Update
              </button>
            </>
          }
        >
          <label className="field">
            Current password
            <input className="input" type="password" autoFocus value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </label>
          <label className="field">
            New password (min 6 characters)
            <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label className="field">
            Confirm new password
            <input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && changePassword()} />
          </label>
        </Modal>
      )}
    </div>
  );
}
