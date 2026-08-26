/* Small inline SVG icon set (stroke icons, currentColor) so the UI doesn't depend on emoji/unicode glyphs. */
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const I = (paths) =>
  function Icon({ size = 20, ...rest }) {
    return (
      <svg {...base} width={size} height={size} aria-hidden="true" {...rest}>
        {paths}
      </svg>
    );
  };

export const HomeIcon = I(
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </>
);
export const SunIcon = I(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>
);
export const FolderIcon = I(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />);
export const CheckSquareIcon = I(
  <>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="m8 12 3 3 5-6" />
  </>
);
export const PenIcon = I(
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </>
);
export const FlagIcon = I(
  <>
    <path d="M4 22V4" />
    <path d="M4 4h12l-2 4 2 4H4" />
  </>
);
export const BellIcon = I(
  <>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </>
);
export const PlusIcon = I(<path d="M12 5v14M5 12h14" />);
export const MenuIcon = I(<path d="M4 7h16M4 12h16M4 17h16" />);
export const TargetIcon = I(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </>
);
export const KeyIcon = I(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 5l2 2M14 8l2 2" />
  </>
);
export const LogOutIcon = I(
  <>
    <path d="M10 17l5-5-5-5" />
    <path d="M15 12H3" />
    <path d="M13 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
  </>
);
export const DownloadIcon = I(
  <>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 19h16" />
  </>
);
export const ClockIcon = I(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
);
export const SearchIcon = I(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
);
export const ChevronIcon = I(<path d="m9 6 6 6-6 6" />);
export const WalletIcon = I(
  <>
    <path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <path d="M16 12h4v4h-4a2 2 0 0 1 0-4z" />
    <path d="M3 9h17" />
  </>
);
export const MailIcon = I(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </>
);
export const SettingsIcon = I(
  <>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </>
);
export const RefreshIcon = I(
  <>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 4v5h-5" />
  </>
);
export const TrendIcon = I(
  <>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M14 7h7v7" />
  </>
);
export const SparkIcon = I(
  <>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </>
);
