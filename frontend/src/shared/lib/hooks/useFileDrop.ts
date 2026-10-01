import { useEffect, useRef, useState } from 'react';
import { hasDraggedFiles } from '../utils/fileDrop';

interface Params {
  enabled: boolean;
  onDrop: (files: File[]) => void;
}

export function useFileDrop(element: HTMLElement | null, { enabled, onDrop }: Params): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    if (!element) return undefined;

    let depth = 0;
    const reset = () => {
      depth = 0;
      setIsDragging(false);
    };

    const intercept = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    };

    const handleEnter = (event: DragEvent) => {
      if (!intercept(event) || !enabled) return;
      depth += 1;
      setIsDragging(true);
    };

    const handleOver = (event: DragEvent) => {
      if (intercept(event) && event.dataTransfer) {
        event.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
      }
    };

    const handleLeave = (event: DragEvent) => {
      if (!intercept(event) || !enabled) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    };

    const handleDrop = (event: DragEvent) => {
      if (!intercept(event)) return;
      reset();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (enabled && files.length > 0) onDropRef.current(files);
    };

    const listeners = [
      ['dragenter', handleEnter],
      ['dragover', handleOver],
      ['dragleave', handleLeave],
      ['drop', handleDrop],
    ] as const;

    listeners.forEach(([type, listener]) => element.addEventListener(type, listener, true));
    return () => {
      listeners.forEach(([type, listener]) => element.removeEventListener(type, listener, true));
      reset();
    };
  }, [element, enabled]);

  return isDragging;
}
