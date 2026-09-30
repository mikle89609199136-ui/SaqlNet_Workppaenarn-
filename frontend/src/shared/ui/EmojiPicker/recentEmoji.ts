import { DEFAULT_RECENT_EMOJI, RECENT_EMOJI_LIMIT, STORAGE_KEYS } from '@/shared/config';

/*
 * Недавние эмодзи — удобство одного браузера, не данные аккаунта: в
 * приватном окне или без доступа к хранилищу панель просто начинает с
 * набора по умолчанию.
 */

export function readRecentEmoji(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RECENT_EMOJI);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed.slice(0, RECENT_EMOJI_LIMIT);
    }
  } catch {
    // Нет хранилища или в нём мусор — набор по умолчанию.
  }
  return [...DEFAULT_RECENT_EMOJI];
}

/** Выбранный — первым, без повторов. */
export function rememberEmoji(recent: string[], emoji: string): string[] {
  const next = [emoji, ...recent.filter((item) => item !== emoji)].slice(0, RECENT_EMOJI_LIMIT);
  try {
    localStorage.setItem(STORAGE_KEYS.RECENT_EMOJI, JSON.stringify(next));
  } catch {
    // Не сохранилось — недавние живут до перезагрузки.
  }
  return next;
}
