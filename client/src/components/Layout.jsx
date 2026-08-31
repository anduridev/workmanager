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
import { HomeIcon, SunIcon, FolderIcon, CheckSquareIcon, PenIcon, FlagIcon, ClockIcon, MenuIcon, PlusIcon, TargetIcon, KeyIcon, LogOutIcon, DownloadIcon, LifebuoyIcon } from './icons';

const NAV = [
  { to: '/', label: 'Dashboard', Icon: HomeIcon, end: true },
  { to: '/today', label: 'Today', Icon: SunIcon },
  { to: '/projects', label: 'Work Items', Icon: FolderIcon },
  { to: '/tasks', label: 'My Tasks', Icon: CheckSquareIcon },
  { to: '/notes', label: 'Notes', Icon: PenIcon },
  { to: '/team', label: 'Team & Targets', Icon: FlagIcon },
  { to: '/reminders', label: 'Reminders', Icon: ClockIcon },
  { to: '/zendesk', label: 'Zendesk', Icon: LifebuoyIcon },
  // Expenses is hidden from navigation for now (still reachable at /expenses, password-locked)
];
// Phone bottom bar: the four most-used screens + "More" for the rest
const TABS = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/today', label: 'Today', Icon: SunIcon },
  { to: '/tasks', label: 'Tasks', Icon: CheckSquareIcon },
  { to: '/team', label: 'Team', Icon: FlagIcon },
];
const MORE_PATHS = ['/projects', '/notes', '/reminders', '/zendesk', '/expenses'];

const Badge = ({ n, className = '' }) =>
  n > 0 ? <span className={`grid h-5 min-w-[20px] place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-none text-white ${className}`}>{n}</span> : null;

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
  const name = user?.displayName || user?.username || '';

  const addItems = [
    { icon: <CheckSquareIcon />, label: 'New task', onClick: () => navigate('/tasks?new=1') },
    { icon: <SunIcon />, label: 'Add to today’s list', onClick: () => navigate('/today?add=1') },
    { icon: <ClockIcon />, label: 'New reminder', onClick: () => navigate('/reminders?new=1') },
    { icon: <PenIcon />, label: 'New note', onClick: () => navigate('/notes?new=1') },
    { icon: <TargetIcon />, label: 'New team target', onClick: () => navigate('/team?new=1') },
    { icon: <FolderIcon />, label: 'New work item', onClick: () => navigate('/projects?new=1') },
  ];
  const moreItems = [
    { icon: <FolderIcon />, label: 'Work Items', onClick: () => navigate('/projects') },
    { icon: <PenIcon />, label: 'Notes', onClick: () => navigate('/notes') },
    { icon: <ClockIcon />, label: 'Reminders', onClick: () => navigate('/reminders'), badge: notif.unreadCount || 0 },
    { icon: <LifebuoyIcon />, label: 'Zendesk', onClick: () => navigate('/zendesk') },
    ...(!install.standalone
      ? [{ icon: <DownloadIcon />, label: 'Add to home screen', hint: 'Install WorkPA as an app — opens full screen, gets push notifications', onClick: doInstall }]
      : []),
    { icon: <KeyIcon />, label: 'Change password', onClick: () => setPw({ current: '', next: '', confirm: '' }) },
    { icon: <LogOutIcon />, label: 'Sign out', danger: true, onClick: onLogout },
  ];

  const footBtn = 'flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900';

  return (
    <div className="flex min-h-screen bg-slate-50 bg-page bg-fixed bg-no-repeat">
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-slate-200/70 bg-white/70 px-4 py-6 backdrop-blur md:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-lg font-extrabold text-white shadow-glow">✓</div>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight text-slate-900">WorkPA</div>
            <div className="text-xs text-slate-500">Your personal assistant</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `group flex h-10 items-center gap-3 rounded-xl px-3.5 text-sm font-medium transition ${
                  isActive ? 'bg-brand text-white shadow-glow' : 'text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-card'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <n.Icon size={18} className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-primary-600'} />
                  <span>{n.label}</span>
                  {n.to === '/reminders' && <Badge n={notif.unreadCount} className="ml-auto" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5 border-t border-slate-200 pt-4">
          <div className="mb-2 flex items-center gap-3 px-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm font-bold text-white">{name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
              <div className="text-xs text-slate-500">Signed in</div>
            </span>
          </div>
          {!install.standalone && (
            <button className={footBtn} onClick={doInstall} title="Install WorkPA as an app">
              <DownloadIcon size={16} className="text-slate-400" /> Install app
            </button>
          )}
          <button className={footBtn} onClick={() => setPw({ current: '', next: '', confirm: '' })}>
            <KeyIcon size={16} className="text-slate-400" /> Change password
          </button>
          <button className={footBtn} onClick={onLogout}>
            <LogOutIcon size={16} className="text-slate-400" /> Sign out
          </button>
        </div>
      </aside>

      {/* ---------- Main column ---------- */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-[56px] items-center justify-between gap-3 border-b border-slate-200/70 bg-white/70 px-4 backdrop-blur max-md:pt-[env(safe-area-inset-top)] md:h-16 md:px-6">
          <div className="flex items-center gap-2.5 md:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-base font-extrabold text-white shadow-glow">✓</div>
            <div className="leading-tight">
              <div className="text-[15px] font-bold tracking-tight text-slate-900">WorkPA</div>
              <div className="text-xs text-slate-500">{dayjs().format('dddd, DD MMM')}</div>
            </div>
          </div>
          <div className="hidden text-sm text-slate-500 md:block">
            <span className="mr-1.5 font-semibold text-slate-900">{dayjs().format('dddd')}</span>
            {dayjs().format('DD MMMM YYYY')}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm hidden md:inline-flex" onClick={() => navigate('/tasks?new=1')}>
              <PlusIcon size={15} /> Task
            </button>
            <button className="btn btn-sm hidden md:inline-flex" onClick={() => navigate('/reminders?new=1')}>
              <PlusIcon size={15} /> Reminder
            </button>
            <NotificationBell notif={notif} onInstallHelp={() => setHowTo(true)} standalone={install.standalone} />
          </div>
        </header>

        {showBanner && (
          <div className="flex items-center gap-3 border-b border-primary-100 bg-primary-50 px-4 py-2 text-[13px] text-slate-600">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-primary-600 shadow-sm">
              <DownloadIcon size={18} />
            </span>
            <span className="min-w-0 flex-1 leading-snug">
              <b className="text-slate-900">Add to home screen</b>
              <br />
              <span className="text-xs text-slate-500">Opens as an app · reminders even when closed</span>
            </span>
            <button className="btn btn-sm btn-primary !h-9 !px-3 !text-[13px]" onClick={doInstall}>
              {install.canPrompt ? 'Install' : 'How?'}
            </button>
            <button className="close !h-9 !w-9" onClick={hideBanner} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl px-4 pb-[calc(144px+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-20 md:pt-6">{children}</main>
      </div>

      {/* ---------- Phone navigation ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `relative flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${isActive && sheet !== 'more' ? 'text-primary-600' : 'text-slate-500'}`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`grid h-7 w-11 place-items-center rounded-full ${isActive && sheet !== 'more' ? 'bg-primary-50' : ''}`}>
                  <t.Icon size={22} />
                </span>
                {t.label}
              </>
            )}
          </NavLink>
        ))}
        <button
          className={`relative flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${moreActive || sheet === 'more' ? 'text-primary-600' : 'text-slate-500'}`}
          onClick={() => setSheet('more')}
        >
          <span className={`grid h-7 w-11 place-items-center rounded-full ${moreActive || sheet === 'more' ? 'bg-primary-50' : ''}`}>
            <MenuIcon size={22} />
          </span>
          More
          {!location.pathname.startsWith('/reminders') && <Badge n={notif.unreadCount} className="absolute left-[calc(50%+8px)] top-1.5 border-2 border-white" />}
        </button>
      </nav>
      <button
        className="fixed right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-glow transition active:scale-95 md:hidden"
        style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}
        onClick={() => setSheet('add')}
        aria-label="Add"
      >
        <PlusIcon size={28} />
      </button>

      {sheet === 'add' && <Sheet title="Add…" items={addItems} onClose={() => setSheet(null)} />}
      {sheet === 'more' && <Sheet title={`Signed in as ${name}`} items={moreItems} onClose={() => setSheet(null)} />}
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
        ['Open WorkPA from the new icon', 'Then tap the bell → Enable push to get reminders on this phone.'],
      ]
    : install.android
      ? [
          ['Open the browser menu', 'The ⋮ (three dots) button in Chrome, Edge or Samsung Internet.'],
          ['Tap “Install app” or “Add to Home screen”', 'Confirm on the popup.'],
          ['Open WorkPA from the new icon', 'Then tap the bell → Enable push to get reminders on this phone.'],
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
          <li key={t} className="pl-1">
            <b className="font-semibold text-slate-900">{t}</b>
            <div className="text-[13px] text-slate-500">{d}</div>
          </li>
        ))}
      </ol>
      <div className="text-[13px] text-slate-500">Installed, WorkPA opens full screen from its own icon, and push notifications (reminders, follow-ups, the morning digest) work even when the app is closed.</div>
    </Modal>
  );
}
