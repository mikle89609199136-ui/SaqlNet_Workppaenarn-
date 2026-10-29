import { isUnsent } from '@/entities/message';
import type { IMediaItem, TMediaMessageType } from '@/types';

/**
 * Какие пункты меню действий доступны для сообщения (#655).
 *
 * Правило одно: недоступный пункт скрывается, а не отключается. Прежде
 * меню предлагало «Изменить» у голосового и звонка, «Копировать» у
 * стикера (копировалась пустота), закрепить и переслать ещё не
 * отправленное — всё это либо не работало, либо падало на сервере.
 */
export type TMessageAction =
  | 'react'
  | 'viewReactions'
  | 'reply'
  | 'copyText'
  | 'copyImage'
  | 'save'
  | 'translate'
  | 'edit'
  | 'pin'
  | 'unpin'
  | 'forward'
  | 'select'
  | 'delete';

/** Где открыто меню: лента чата или список закреплённых — там нет поля ввода и диалога удаления. */
export type TMessageActionPlace = 'thread' | 'pinned';

export interface IMessageActionContext {
  mine: boolean;
  place: TMessageActionPlace;
  isPinned: boolean;
  /** Браузер умеет класть картинку в буфер обмена. */
  canCopyImage: boolean;
}

/** Вложения, которые можно сохранить: всё, кроме стикеров и GIF — это не файлы человека. */
const SAVABLE: TMediaMessageType[] = ['image', 'video', 'file', 'audio', 'voice'];

/** Правится текст и подпись к фото, видео, файлу; сервер запрещает только стикеры. */
const EDITABLE = ['text', 'image', 'video', 'file'];

/** У этих типов в content нет текста для человека. */
const NO_TEXT = ['sticker', 'gif', 'voice', 'call'];

export function messageMediaType(message: IMediaItem): TMediaMessageType | null {
  const type = message.mediaType || message.type;
  return type === 'text' || type === 'call' ? null : type;
}

/** Текст сообщения или подпись к вложению — то, что можно скопировать и перевести. */
export function hasCopyableText(message: IMediaItem): boolean {
  const type = messageMediaType(message) ?? message.type;
  return !message.undecryptable && !NO_TEXT.includes(type) && Boolean(message.content?.trim());
}

function hasAvailableMedia(message: IMediaItem): boolean {
  return Boolean(message.mediaUrl) && !message.mediaUnavailable;
}

/**
 * Можно ли переслать (#1061): отправленное и расшифрованное, не звонок —
 * его сервер от клиента не принимает, — а вложение только с открывшимся
 * файлом: без него пересылать нечего.
 */
export function canForwardMessage(message: IMediaItem): boolean {
  if (isUnsent(message) || message.undecryptable || message.type === 'call') return false;
  return messageMediaType(message) === null || hasAvailableMedia(message);
}

export function availableMessageActions(
  message: IMediaItem,
  { mine, place, isPinned, canCopyImage }: IMessageActionContext
): Set<TMessageAction> {
  const actions = new Set<TMessageAction>();
  const sent = !isUnsent(message);
  const media = messageMediaType(message);
  const inThread = place === 'thread';

  if (hasCopyableText(message)) actions.add('copyText');
  // Неотправленное: только скопировать текст и убрать из очереди.
  if (!sent) {
    actions.add('delete');
    return actions;
  }

  actions.add('react');
  if (message.reactions && message.reactions.length > 0) {
    actions.add('viewReactions');
  }
  if (inThread) {
    actions.add('reply');
    actions.add('select');
    actions.add('delete');
  }
  if (media === 'image' && hasAvailableMedia(message) && canCopyImage) actions.add('copyImage');
  if (media && SAVABLE.includes(media) && hasAvailableMedia(message)) actions.add('save');
  if (!mine && hasCopyableText(message)) actions.add('translate');
  if (
    mine &&
    inThread &&
    EDITABLE.includes(message.type) &&
    !message.isForwarded &&
    !message.undecryptable
  ) {
    actions.add('edit');
  }
  actions.add(isPinned ? 'unpin' : 'pin');
  if (canForwardMessage(message)) actions.add('forward');

  return actions;
}
