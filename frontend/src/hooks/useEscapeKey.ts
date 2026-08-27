import { useEffect } from 'react';

interface Params {
  active: boolean;
  onClose: () => void;
}

export function useEscapeKey({ active, onClose }: Params) {
  useEffect(() => {
    if (!active) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [active, onClose]);
}
