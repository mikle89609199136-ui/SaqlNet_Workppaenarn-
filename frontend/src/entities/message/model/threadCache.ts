import type { InfiniteData } from '@tanstack/react-query';
import type { IMessageDto, TMediaMessageType, TMessagesList } from './types';
import { getOutboxItem } from './outboxStore';
import { isUnsent } from './messageUtils';
import {
  isCoveredBy,
  receiptPatch,
  sortMessagesChronologically,
  type IReceiptEvent,
} from '@/shared/lib';

/**
 * Форма кеша истории: страницы в том порядке, в каком их загрузили.
 * Первая страница — самые свежие сообщения, последующие уходят вглубь.
 *
 * Тип берётся из библиотеки, а не описывается заново: иначе он разойдётся
 * с тем, что на самом деле лежит в кеше постраничного запроса.
 */
export type IThreadPages = InfiniteData<TMessagesList>;

/** Плоский список для отрисовки: страницы склеиваются и сортируются по времени. */
/**
 * Пустая лента для случая, когда история ещё не загружена.
 *
 * Одна на всех: ленту читают через зависимости эффектов, и новый пустой
 * массив на каждом рендере запускал бы их так же, как новая история.
 */
export const EMPTY_THREAD: TMessagesList = [];

function editedLater(candidate: IMessageDto, kept: IMessageDto): boolean {
  if (!candidate.updatedAt || !kept.updatedAt) return false;
  return new Date(candidate.updatedAt).getTime() > new Date(kept.updatedAt).getTime();
}

/**
 * Страницы склеиваются без повторов.
 *
 * Повтор бывает на стыке страниц: история грузится по смещению, и если
 * за это время пришли новые сообщения, следующая страница начинается с
 * тех, что уже лежат в первой. Они показывались дважды подряд (#1064).
 * Из двух копий остаётся та, что правили позже, а при равенстве — из
 * более ранней страницы: её человек уже видит.
 */
export function flattenThread(data: IThreadPages | undefined): TMessagesList {
  if (!data) return [];
  const byId = new Map<string, IMessageDto>();
  for (const message of data.pages.flat()) {
    const kept = byId.get(message.id);
    if (!kept || editedLater(message, kept)) byId.set(message.id, message);
  }
  return sortMessagesChronologically<IMessageDto>([...byId.values()]);
}

function hasMessage(data: IThreadPages, messageId: string): boolean {
  return data.pages.some((page) => page.some((message) => message.id === messageId));
}

/**
 * Добавляет сообщение в историю.
 *
 * Дедупликация обязательна: одно и то же сообщение приходит дважды —
 * ответом на отправку и эхом от сервера по WebSocket. Без проверки
 * в ленте появлялись бы дубликаты.
 */
export function appendMessage(data: IThreadPages, message: IMessageDto): IThreadPages {
  if (hasMessage(data, message.id)) return data;

  const [firstPage = [], ...restPages] = data.pages;

  return {
    ...data,
    pages: [[...firstPage, message], ...restPages],
  };
}

export function patchMessage(
  data: IThreadPages,
  messageId: string,
  patch: Partial<Omit<IMessageDto, 'id'>>
): IThreadPages {
  if (!hasMessage(data, messageId)) {
    const outboxItem = getOutboxItem(messageId);
    if (outboxItem) {
      const restoredMessage: IMessageDto = {
        id: outboxItem.tempId,
        tempId: outboxItem.tempId,
        chatId: outboxItem.chatId,
        content: outboxItem.content,
        type: outboxItem.type,
        mediaType: outboxItem.type !== 'text' ? (outboxItem.type as TMediaMessageType) : undefined,
        mediaUrl: outboxItem.blobUrl,
        // Голосовое из очереди — со своими длительностью и волной (#843).
        ...(outboxItem.voice ? { voice: outboxItem.voice } : {}),
        replyTo: outboxItem.replyToId ?? null,
        replyToMessageId: outboxItem.replyToId ?? null,
        senderId: outboxItem.senderId,
        senderFirstName: '',
        senderName: '',
        forwardedSenderName: '',
        replySenderName: null,
        replyToSenderName: null,
        createdAt: outboxItem.createdAt,
        updatedAt: outboxItem.createdAt,
        isEdited: false,
        isForwarded: false,
        isPinned: false,
        reactions: [],
        status: patch.status ?? outboxItem.status,
        ...patch,
      };
      return appendMessage(data, restoredMessage);
    }
    return data;
  }

  return {
    ...data,
    pages: data.pages.map((page) =>
      page.map((message) => (message.id === messageId ? { ...message, ...patch } : message))
    ),
  };
}

/**
 * Сдвиг границы собеседника (#657): его сообщения не трогаются, свои до
 * `upTo` включительно получают время доставки или прочтения. Сообщения из
 * очереди отправки ещё не на сервере — граница их не переходит. Ничего не
 * изменилось — возвращается тот же объект, и лента не перерисовывается.
 */
export function applyReceipt(data: IThreadPages, event: IReceiptEvent): IThreadPages {
  let changed = false;
  const pages = data.pages.map((page) =>
    page.map((message) => {
      if (message.senderId === event.userId || message.tempId) return message;
      if (message.status === 'pending' || message.status === 'uploading') return message;
      if (message.status === 'failed' || !isCoveredBy(message.createdAt, event.upTo)) {
        return message;
      }
      const patch = receiptPatch(message, event.kind, event.at);
      if (!patch) return message;
      changed = true;
      return { ...message, ...patch };
    })
  );
  return changed ? { ...data, pages } : data;
}

export function removeMessage(data: IThreadPages, messageId: string): IThreadPages {
  if (!hasMessage(data, messageId)) return data;

  return {
    ...data,
    pages: data.pages.map((page) => page.filter((message) => message.id !== messageId)),
  };
}

/**
 * Пропущенные удаления после обрыва связи (#1068).
 *
 * Удаление приходит только событием, и пропущенное за время обрыва
 * оставалось в ленте. Сервер в истории удалённых и скрытых не отдаёт,
 * поэтому подтверждённое сообщение, которого нет в свежей странице, хотя
 * по времени оно внутри неё, удалили или скрыли.
 *
 * Граница — строго новее самого старого сообщения страницы: у сервера нет
 * второго ключа сортировки, и сообщение с тем же временем могло просто
 * не поместиться. Старше границы ничего не трогаем — это прокрученная
 * история. Неотправленные сервер ещё не знает. Пустая страница ничего не
 * удаляет: её не отличить от неполного ответа.
 */
export function dropMissingFromHead(data: IThreadPages, page: IMessageDto[]): IThreadPages {
  if (page.length === 0) return data;

  const fresh = new Set(page.map((message) => message.id));
  const oldest = Math.min(...page.map((message) => new Date(message.createdAt).getTime()));
  if (!Number.isFinite(oldest)) return data;

  let changed = false;
  const pages = data.pages.map((items) =>
    items.filter((message) => {
      const missing =
        !fresh.has(message.id) &&
        !isUnsent(message) &&
        new Date(message.createdAt).getTime() > oldest;
      if (missing) changed = true;
      return !missing;
    })
  );

  return changed ? { ...data, pages } : data;
}

/**
 * Цитаты на удалённые сообщения (#1065).
 *
 * Превью исходника приходит от сервера вместе с ответом. После удаления
 * у всех или скрытия у себя его текст иначе оставался бы в плашке до
 * перезагрузки — а после неё сервер его уже не отдаёт.
 */
export function forgetReplyPreviews(data: IThreadPages, removedIds: string[]): IThreadPages {
  const removed = new Set(removedIds);
  let changed = false;
  const pages = data.pages.map((page) =>
    page.map((message) => {
      const target = message.replyTo || message.replyToMessageId;
      if (!message.replyPreview || !target || !removed.has(target)) return message;
      changed = true;
      return { ...message, replyPreview: undefined };
    })
  );

  return changed ? { ...data, pages } : data;
}

export function replaceMessage(
  data: IThreadPages,
  targetId: string,
  replacement: IMessageDto
): IThreadPages {
  if (!hasMessage(data, targetId)) {
    return appendMessage(data, replacement);
  }

  if (targetId !== replacement.id && hasMessage(data, replacement.id)) {
    return removeMessage(data, targetId);
  }

  return {
    ...data,
    pages: data.pages.map((page) =>
      page.map((message) => (message.id === targetId ? replacement : message))
    ),
  };
}

/**
 * Решает, можно ли дописать сообщение в кеш чата.
 *
 * Правило выстрадано дефектом #174: если истории чата в кеше ещё нет,
 * запись из одного сообщения будет принята за всю историю, и чат откроется
 * почти пустым. Такое сообщение нужно не дописывать, а инвалидировать чат,
 * чтобы историю загрузили с сервера целиком.
 */
export function canAppendToThread(data: IThreadPages | undefined): data is IThreadPages {
  return Boolean(data?.pages?.length);
}
