import { useEffect } from 'react';

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** Lock body scroll while an overlay is open (stops the page behind from scrolling on phones). */
function useScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

export default function Modal({ title, onClose, children, footer, wide }) {
  useEscape(onClose);
  useScrollLock();
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, actions }) {
  useEscape(onClose);
  useScrollLock();
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <button className="close back md:hidden" onClick={onClose} aria-label="Back">
            ‹
          </button>
          <div className="min-w-0 flex-1">{title}</div>
          <div className="flex items-center gap-2">
            {actions}
            <button className="close hidden md:grid" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

/** Bottom action sheet (phones) — a simple list of actions. `items` = [{label, icon, onClick, danger, hint, badge}] */
export function Sheet({ title, onClose, items = [], children }) {
  useEscape(onClose);
  useScrollLock();
  return (
    <div className="overlay sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        {title && <div className="sheet-title">{title}</div>}
        {children}
        {items.length > 0 && (
          <div className="sheet-list">
            {items.map((it) => (
              <button
                key={it.label}
                className={`sheet-item ${it.danger ? 'danger' : ''}`}
                onClick={() => {
                  onClose?.();
                  it.onClick?.();
                }}
              >
                <span className="ico">{it.icon}</span>
                <span className="min-w-0 flex-1">
                  {it.label}
                  {it.hint && <small>{it.hint}</small>}
                </span>
                {it.badge ? <span className="count">{it.badge}</span> : null}
              </button>
            ))}
          </div>
        )}
        <button className="btn sheet-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function confirm(message) {
  return window.confirm(message);
}
