import { useEffect, useReducer } from 'react';
import type { IChatDto } from './types';

/** Истечение действует и у давно открытого query cache. Невалидный срок не снимает mute. */
export function isChatMuted(
  chat?: Pick<IChatDto, 'isMuted' | 'mutedUntil'>,
  now = Date.now()
): boolean {
  if (!chat?.isMuted) return false;
  if (!chat.mutedUntil) return true;
  const until = Date.parse(chat.mutedUntil);
  return !Number.isFinite(until) || until > now;
}

export function useChatMuted(chat: Pick<IChatDto, 'isMuted' | 'mutedUntil'>): boolean {
  const [version, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!chat.isMuted || !chat.mutedUntil) return;
    const remaining = Date.parse(chat.mutedUntil) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(refresh, Math.min(remaining + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [chat.isMuted, chat.mutedUntil, version]);
  return isChatMuted(chat);
}
