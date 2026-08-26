import { useEffect, useState } from 'react';

export const MOBILE_QUERY = '(max-width: 760px)';

/** True when the viewport matches a media query (updates live on resize/rotation). */
export function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange));
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMedia(MOBILE_QUERY);
