import { useEffect, useRef } from 'react';

interface Params {
  active: boolean;
  onClose: () => void;
}

export function useEscapeKey({ active, onClose }: Params) {
  const onCloseRef = useRef(onClose);

  /* Запись в ссылку — в эффекте, а не в теле хука. Во время отрисовки
     менять ссылки нельзя: React вправе отбросить рендер и начать заново,
     а изменение уже случилось. */
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [active]);
}
