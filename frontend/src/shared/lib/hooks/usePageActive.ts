import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('focus', onChange);
  window.addEventListener('blur', onChange);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('focus', onChange);
    window.removeEventListener('blur', onChange);
  };
}

const getSnapshot = () => document.visibilityState === 'visible' && document.hasFocus();

const getServerSnapshot = () => false;

export function usePageActive(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
