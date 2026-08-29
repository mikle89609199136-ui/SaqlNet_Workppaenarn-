import { cn } from '@/utils';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type PropsWithChildren,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

interface Props {
  menuRef: RefObject<HTMLUListElement | null>;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

interface Rect {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
}

export const SelectMenu = ({ menuRef, anchorRef, onClose, children }: PropsWithChildren<Props>) => {
  const [rect, setRect] = useState<Rect | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const box = anchor.getBoundingClientRect();
    
    const maxMenuHeight = 250; // max-h-61 + buffer
    const spaceBelow = window.innerHeight - box.bottom;

    if (spaceBelow < maxMenuHeight && box.top > spaceBelow) {
      setRect({
        bottom: window.innerHeight - box.top + 6,
        left: box.left,
        width: box.width,
      });
    } else {
      setRect({
        top: box.bottom + 6,
        left: box.left,
        width: box.width,
      });
    }
  }, [anchorRef]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    function handleScroll(e: Event) {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      onClose();
    }
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [updatePosition, onClose, menuRef]);

  if (!rect) return null;

  return createPortal(
    <ul
      ref={menuRef}
      role="listbox"
      className={cn(
        'fixed z-30 m-0 max-h-61 list-none overflow-y-auto p-1.5 styled-scrollbar',
        'rounded-field border border-line bg-sheet shadow-[var(--elev-3)] min-w-min',
        '[overscroll-behavior:contain]'
      )}
      style={{
        top: rect.top !== undefined ? rect.top : undefined,
        bottom: rect.bottom !== undefined ? rect.bottom : undefined,
        left: rect.left,
        width: rect.width,
      }}
    >
      {children}
    </ul>,
    document.body
  );
};
