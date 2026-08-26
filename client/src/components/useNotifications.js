import { useCallback, useEffect, useRef, useState } from 'react';
import { Notifications } from '../lib/api';
import { useToast } from './Toast';

const POLL_MS = 30 * 1000;

/**
 * Polls the server for notifications, surfaces fresh ones as toasts + browser notifications,
 * and exposes the list for the bell dropdown.
 */
export function useNotifications() {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const toast = useToast();
  const firstLoad = useRef(true);
  const audioRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await Notifications.list();
      setItems(data.items);
      setUnreadCount(data.unreadCount);
      // Announce fresh (never delivered) ones — but not on the very first load, to avoid a toast storm
      if (!firstLoad.current && data.fresh.length) {
        const fresh = data.items.filter((n) => data.fresh.includes(String(n._id)));
        fresh.forEach((n) => announce(n));
      }
      firstLoad.current = false;
    } catch {
      /* server unreachable — ignore, try again next poll */
    }
  }, []);

  const announce = (n) => {
    toast.remind(n.title, n.body, [
      { label: 'Mark read', onClick: () => markRead(n._id) },
    ]);
    beep();
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const bn = new Notification(n.title, { body: n.body, icon: '/favicon.svg', tag: String(n._id) });
        bn.onclick = () => window.focus();
      } catch {
        /* ignore */
      }
    }
  };

  const beep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioRef.current = audioRef.current || new Ctx();
      const ctx = audioRef.current;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.18);
    } catch {
      /* ignore */
    }
  };

  const markRead = async (id) => {
    await Notifications.read(id);
    setItems((l) => l.map((n) => (n._id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };
  const markAllRead = async () => {
    await Notifications.readAll();
    setItems((l) => l.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };
  const remove = async (id) => {
    await Notifications.remove(id);
    setItems((l) => l.filter((n) => n._id !== id));
    refresh();
  };
  const clearRead = async () => {
    await Notifications.clearRead();
    refresh();
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  const requestPermission = () => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  };

  return { items, unreadCount, refresh, markRead, markAllRead, remove, clearRead, requestPermission };
}
