import { useEffect, useRef, useState } from 'react';

/** Overflow "⋯" menu — keeps secondary actions out of the way. items = [{label, onClick, danger, icon}] */
export default function Menu({ items, label = 'More', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={`relative ${className}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="btn btn-ghost btn-icon btn-sm text-lg leading-none" onClick={() => setOpen((o) => !o)} aria-label={label} title={label}>
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-[190px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lift animate-pop">
          {items.map((it) => (
            <button
              key={it.label}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-slate-50 max-md:min-h-[44px] ${it.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700'}`}
              onClick={() => {
                setOpen(false);
                it.onClick?.();
              }}
            >
              {it.icon && <span className="text-slate-400">{it.icon}</span>}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
