import { useEffect, useRef } from 'react';

interface Params {
  active: boolean;
  onClose: () => void;
}

export function useEscapeKey({ active, onClose }: Params) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [active]);
}
