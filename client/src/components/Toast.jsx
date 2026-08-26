import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastCtx = createContext(null);

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
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <div className="tb">
              <div className="tt">{t.title}</div>
              {t.text && <div className="tx">{t.text}</div>}
              {t.actions && (
                <div className="ta">
                  {t.actions.map((a) => (
                    <button
                      key={a.label}
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
            <button className="close" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
