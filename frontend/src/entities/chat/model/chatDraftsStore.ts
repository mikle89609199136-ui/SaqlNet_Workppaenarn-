/**
 * Недописанные сообщения.
 *
 * У каждого чата свой черновик: ушёл в соседний разговор, вернулся — текст
 * на месте. Живут только в памяти вкладки, на диск не попадают: это
 * открытый текст, и оставлять его после закрытия приложения — не то, чего
 * ждут от мессенджера со сквозным шифрованием.
 *
 * Хранилище намеренно не на React: набор текста не должен ничего
 * перерисовывать. Подписка нужна одному лишь списку чатов, где черновик
 * показывается вместо превью, и уведомляется он не на каждый символ.
 */

/** Через сколько после остановки набора сообщать списку чатов. */
const SETTLE_DELAY_MS = 500;

const drafts = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function announce(chatId: string): void {
  for (const listener of listeners.get(chatId) ?? []) listener();
}

function cancelPending(chatId: string): void {
  const timer = pending.get(chatId);
  if (timer === undefined) return;

  clearTimeout(timer);
  pending.delete(chatId);
}

export function readDraft(chatId: string): string {
  return drafts.get(chatId) ?? '';
}

/**
 * Запомнить набранное.
 *
 * Список чатов узнает об этом, когда человек перестанет печатать: обновлять
 * строку на каждый символ значит заставлять её мигать всё время набора.
 */
export function writeDraft(chatId: string, text: string): void {
  drafts.set(chatId, text);

  cancelPending(chatId);
  pending.set(
    chatId,
    setTimeout(() => {
      pending.delete(chatId);
      announce(chatId);
    }, SETTLE_DELAY_MS)
  );
}

/**
 * Черновика больше нет — сообщение отправлено или чат удалён.
 *
 * Об этом сообщается сразу: отложи уведомление, и в списке останется
 * пометка о черновике, которого уже нет.
 */
export function clearDraft(chatId: string): void {
  cancelPending(chatId);
  drafts.delete(chatId);
  announce(chatId);
}

export function subscribeToDraft(chatId: string, listener: () => void): () => void {
  const forChat = listeners.get(chatId) ?? new Set<() => void>();
  forChat.add(listener);
  listeners.set(chatId, forChat);

  return () => {
    forChat.delete(listener);
    if (forChat.size === 0) listeners.delete(chatId);
  };
}

/** Выход из аккаунта: недописанное не должно достаться следующему. */
export function clearAllDrafts(): void {
  for (const chatId of [...pending.keys()]) cancelPending(chatId);

  drafts.clear();
}
