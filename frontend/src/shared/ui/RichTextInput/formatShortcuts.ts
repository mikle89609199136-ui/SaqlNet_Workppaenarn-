import { CONTROL_OR_META, isExactShortcutMatch, type TextFormatType } from 'lexical';

/**
 * Сочетания форматирования, которых нет в самом Lexical (#656): жирный,
 * курсив и подчёркнутый (Ctrl+B/I/U) он обрабатывает сам.
 *
 * Сравнение через `isExactShortcutMatch`: при русской раскладке `event.key`
 * — «ч», «ь», «р», и сравнение по нему молча не срабатывало. Lexical в таком
 * случае смотрит на физическую клавишу.
 *
 * Спойлер — не Ctrl+Shift+P, как в Telegram Desktop: в Firefox и Edge это
 * приватное окно, и такие сочетания браузер страницу даже не спрашивает.
 */
export const FORMAT_SHORTCUTS: ReadonlyArray<{ format: TextFormatType; key: string }> = [
  { format: 'strikethrough', key: 'x' },
  { format: 'code', key: 'm' },
  { format: 'highlight', key: 'h' },
];

const WITH_SHIFT = { ...CONTROL_OR_META, shiftKey: true };

export function matchFormatShortcut(event: KeyboardEvent): TextFormatType | null {
  return (
    FORMAT_SHORTCUTS.find(({ key }) => isExactShortcutMatch(event, key, WITH_SHIFT))?.format ?? null
  );
}

export function isLinkShortcut(event: KeyboardEvent): boolean {
  return isExactShortcutMatch(event, 'k', CONTROL_OR_META);
}

/** Подсказка в меню: как нажимать это сочетание. */
export function shortcutHint(format: TextFormatType): string | undefined {
  const found = FORMAT_SHORTCUTS.find((item) => item.format === format);
  return found && `Ctrl+Shift+${found.key.toUpperCase()}`;
}
