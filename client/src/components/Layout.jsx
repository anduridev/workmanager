import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { dayjs } from '../lib/date';
import { Auth } from '../lib/api';
import { useInstall, installBannerDismissed, dismissInstallBanner } from '../lib/install';
import { useIsMobile } from '../lib/useMedia';
import NotificationBell from './NotificationBell';
import Modal, { Sheet } from './Modal';
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
// Phone bottom bar: the four most-used screens + "More" for the rest
const TABS = [
  { to: '/', label: 'Home', ico: '◈', end: true },
  { to: '/today', label: 'Today', ico: '☀' },
  { to: '/tasks', label: 'Tasks', ico: '☑' },
  { to: '/team', label: 'Team', ico: '⚑' },
];
const MORE_PATHS = ['/projects', '/notes', '/reminders'];

export default function Layout({ children, user, onLogout }) {
  const notif = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const isMobile = useIsMobile();
  const install = useInstall();
  const [pw, setPw] = useState(null); // {current, next, confirm}
  const [sheet, setSheet] = useState(null); // 'more' | 'add'
  const [howTo, setHowTo] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(installBannerDismissed());

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

  const doInstall = async () => {
    if (install.canPrompt) {
      const r = await install.prompt();
      if (r === 'accepted') toast.success('WorkPA installed', 'Open it from your home screen and enable push from the bell.');
      return;
    }
    setHowTo(true);
  };
  const hideBanner = () => {
    dismissInstallBanner();
    setBannerHidden(true);
  };

  const showBanner = isMobile && !install.standalone && !bannerHidden;
  const moreActive = MORE_PATHS.some((p) => location.pathname.startsWith(p));

  const addItems = [
    { icon: '☑', label: 'New task', onClick: () => navigate('/tasks?new=1') },
    { icon: '☀', label: 'Add to today’s list', onClick: () => navigate('/today?add=1') },
    { icon: '⏰', label: 'New reminder', onClick: () => navigate('/reminders?new=1') },
    { icon: '✎', label: 'New note', onClick: () => navigate('/notes?new=1') },
    { icon: '🎯', label: 'New team target', onClick: () => navigate('/team?new=1') },
    { icon: '▤', label: 'New project', onClick: () => navigate('/projects?new=1') },
  ];
  const moreItems = [
    { icon: '▤', label: 'Projects', onClick: () => navigate('/projects') },
    { icon: '✎', label: 'Notes', onClick: () => navigate('/notes') },
    { icon: '⏰', label: 'Reminders', onClick: () => navigate('/reminders'), badge: notif.unreadCount || 0 },
    ...(!install.standalone
      ? [{ icon: '📲', label: 'Add to home screen', hint: 'Install WorkPA as an app — opens full screen, gets push notifications', onClick: doInstall }]
      : []),
    { icon: '🔑', label: 'Change password', onClick: () => setPw({ current: '', next: '', confirm: '' }) },
    { icon: '⏻', label: 'Sign out', danger: true, onClick: onLogout },
  ];

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
          {!install.standalone && (
            <button onClick={doInstall} title="Install WorkPA as an app">
              📲 Install app
            </button>
          )}
          <button onClick={() => setPw({ current: '', next: '', confirm: '' })}>Change password</button>
          <button onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="brand topbar-brand mobile-only">
            <div className="brand-logo">✓</div>
            <span>
              WorkPA
              <small>{dayjs().format('dddd, DD MMM')}</small>
            </span>
          </div>
          <div className="date desktop-only">{dayjs().format('dddd, DD MMMM YYYY')}</div>
          <div className="topbar-actions">
            <button className="btn btn-sm desktop-only" onClick={() => navigate('/tasks?new=1')}>
              + Task
            </button>
            <button className="btn btn-sm desktop-only" onClick={() => navigate('/reminders?new=1')}>
              + Reminder
            </button>
            <NotificationBell notif={notif} onInstallHelp={() => setHowTo(true)} standalone={install.standalone} />
          </div>
        </header>
        {showBanner && (
          <div className="install-banner">
            <span>📲</span>
            <span className="grow">
              <b>Add WorkPA to your home screen</b> — opens like an app and gets reminders even when closed.
            </span>
            <button className="btn btn-sm btn-primary" onClick={doInstall}>
              {install.canPrompt ? 'Install' : 'How?'}
            </button>
            <button className="close" onClick={hideBanner} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        <main className="content">{children}</main>
      </div>

      {/* Phone navigation */}
      <nav className="tabbar mobile-only" aria-label="Main">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive && sheet !== 'more' ? 'active' : '')}>
            <span className="ico">{t.ico}</span>
            <span className="lbl">{t.label}</span>
          </NavLink>
        ))}
        <button className={moreActive || sheet === 'more' ? 'active' : ''} onClick={() => setSheet('more')}>
          <span className="ico">☰</span>
          <span className="lbl">More</span>
          {notif.unreadCount > 0 && !location.pathname.startsWith('/reminders') && <span className="count">{notif.unreadCount}</span>}
        </button>
      </nav>
      <button className="fab mobile-only" onClick={() => setSheet('add')} aria-label="Add">
        +
      </button>

      {sheet === 'add' && <Sheet title="Add…" items={addItems} onClose={() => setSheet(null)} />}
      {sheet === 'more' && <Sheet title={`Signed in as ${user?.displayName || user?.username}`} items={moreItems} onClose={() => setSheet(null)} />}

      {howTo && <InstallHelp install={install} onClose={() => setHowTo(false)} />}

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

/** Step-by-step "Add to Home Screen" instructions for browsers that don't fire the install prompt (all of iOS, Firefox, …). */
function InstallHelp({ install, onClose }) {
  const steps = install.ios
    ? [
        ['Open WorkPA in Safari', 'Other iPhone browsers can’t install web apps with notifications.'],
        ['Tap the Share button', 'The square with an arrow at the bottom of the screen.'],
        ['Scroll down and tap “Add to Home Screen”', 'Then tap Add in the top-right corner.'],
        ['Open WorkPA from the new icon', 'Then tap the 🔔 bell → Enable push to get reminders on this phone.'],
      ]
    : install.android
      ? [
          ['Open the browser menu', 'The ⋮ (three dots) button in Chrome, Edge or Samsung Internet.'],
          ['Tap “Install app” or “Add to Home screen”', 'Confirm on the popup.'],
          ['Open WorkPA from the new icon', 'Then tap the 🔔 bell → Enable push to get reminders on this phone.'],
        ]
      : [
          ['Use Chrome or Edge', 'Look for the install icon (a monitor with an arrow) at the right end of the address bar.'],
          ['Click it and confirm “Install”', 'WorkPA opens in its own window, without browser tabs.'],
        ];
  return (
    <Modal
      title="Add WorkPA to your home screen"
      onClose={onClose}
      footer={
        <>
          {install.canPrompt && (
            <button className="btn btn-primary" onClick={() => install.prompt().then(onClose)}>
              Install now
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Got it
          </button>
        </>
      }
    >
      <ol className="steps">
        {steps.map(([t, d]) => (
          <li key={t}>
            <b>{t}</b>
            <div className="muted small">{d}</div>
          </li>
        ))}
      </ol>
      <div className="small muted">Installed, WorkPA opens full screen from its own icon, and push notifications (reminders, follow-ups, the morning digest) work even when the app is closed.</div>
    </Modal>
  );
}
