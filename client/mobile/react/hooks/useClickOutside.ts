import { type RefObject, useEffect } from 'react';

export const useClickOutside = <T extends HTMLElement>(
  ref: RefObject<T | null>,
  cb: () => void
) => {
  const handleClick = (e: PointerEvent) => {
    if (
      ref &&
      ref.current instanceof Node &&
      e.target instanceof Node &&
      !ref.current.contains(e.target)
    ) {
      cb();
    }
  };

  useEffect(() => {
    document.addEventListener('pointerdown', handleClick);
    return () => {
      document.removeEventListener('pointerdown', handleClick);
    };
  }, []);
};
