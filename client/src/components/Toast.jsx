import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastCtx = createContext(null);
const TONE = { info: 'bg-slate-900', error: 'bg-red-600', remind: 'bg-primary-700' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (toast) => {
      const id = ++idRef.current;
      const t = { id, type: 'info', duration: 3500, ...toast };
      setToasts((list) => [...list, t]);
      if (t.duration > 0) setTimeout(() => dismiss(id), t.duration);
      return id;
    },
    [dismiss]
  );

  const api = {
    push,
    dismiss,
    success: (title, text) => push({ title, text }),
    error: (title, text) => push({ title, text, type: 'error', duration: 5000 }),
    remind: (title, text, actions) => push({ title, text, type: 'remind', duration: 0, actions }),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed z-[100] flex flex-col gap-2 max-md:inset-x-2 max-md:top-[calc(8px+env(safe-area-inset-top))] md:bottom-6 md:right-6">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-start gap-3 rounded-xl px-4 py-3 text-white shadow-pop animate-pop md:min-w-[280px] md:max-w-[400px] ${TONE[t.type] || TONE.info}`}>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{t.title}</div>
              {t.text && <div className="mt-0.5 text-xs opacity-85">{t.text}</div>}
              {t.actions && (
                <div className="mt-2 flex gap-1.5">
                  {t.actions.map((a) => (
                    <button
                      key={a.label}
                      className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25"
                      onClick={() => {
                        a.onClick?.();
                        dismiss(t.id);
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-lg leading-none text-white/70 hover:bg-white/10 hover:text-white" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
