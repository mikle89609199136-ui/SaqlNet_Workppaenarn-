import { useIsMobile } from '@/shared/lib';
import { useSyncExternalStore } from 'react';
import { useCallStore } from './callStore';

let stage: HTMLElement | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function setCallStage(element: HTMLElement | null): void {
  if (stage === element) return;
  stage = element;
  listeners.forEach((notify) => notify());
}

export function useCallStage(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => stage,
    () => null
  );
}

export function useInCallStage(): boolean {
  const stage = useCallStage();
  const isMobile = useIsMobile();
  return Boolean(stage) && !isMobile;
}

export function useMinimizedCallOnScreen(): boolean {
  const inStage = useInCallStage();
  const isMinimized = useCallStore((s) => s.isMinimized && Boolean(s.activeCall));
  return isMinimized && !inStage;
}
