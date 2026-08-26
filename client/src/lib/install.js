import { useEffect, useState } from 'react';

/**
 * "Add to Home Screen" / "Install app" support.
 * Chrome/Edge/Samsung on Android + desktop fire `beforeinstallprompt`; we keep the event and show our own button.
 * iOS Safari never fires it — there the user must use Share → Add to Home Screen, so we show instructions instead.
 */
let deferredPrompt = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

/** Call once, as early as possible (before React renders) so the event isn't missed. */
export function initInstall() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try {
      localStorage.setItem('workpa_installed', '1');
    } catch {
      /* ignore */
    }
    emit();
  });
}

export const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true) ||
  (typeof document !== 'undefined' && document.referrer.startsWith('android-app://'));

export const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
// iPadOS 13+ reports itself as a Mac; touch points give it away
export const isIPadOS = () => typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
export const isMobileUA = () => isIOS() || isIPadOS() || isAndroid() || (typeof navigator !== 'undefined' && /Mobile/.test(navigator.userAgent));

export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  const standalone = isStandalone();
  const canPrompt = Boolean(deferredPrompt) && !standalone;
  const prompt = async () => {
    if (!deferredPrompt) return 'unavailable';
    const ev = deferredPrompt;
    deferredPrompt = null;
    emit();
    ev.prompt();
    const choice = await ev.userChoice.catch(() => ({ outcome: 'dismissed' }));
    return choice.outcome; // 'accepted' | 'dismissed'
  };
  return { canPrompt, standalone, ios: isIOS() || isIPadOS(), android: isAndroid(), mobile: isMobileUA(), prompt };
}

const DISMISS_KEY = 'workpa_install_dismissed';
export const installBannerDismissed = () => {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    return v && Date.now() - Number(v) < 7 * 86400000; // ask again after a week
  } catch {
    return false;
  }
};
export const dismissInstallBanner = () => {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
};
