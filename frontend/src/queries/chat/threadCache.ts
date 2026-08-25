import type { InfiniteData } from '@tanstack/react-query';
import type { IMessageDto, TMessagesList } from '@/types';
import { sortMessagesChronologically } from '@/utils/sortMessagesChronologically';

/**
 * Форма кеша истории: страницы в том порядке, в каком их загрузили.
 * Первая страница — самые свежие сообщения, последующие уходят вглубь.
 *
 * Тип берётся из библиотеки, а не описывается заново: иначе он разойдётся
 * с тем, что на самом деле лежит в кеше постраничного запроса.
 */
export type IThreadPages = InfiniteData<TMessagesList>;

/** Плоский список для отрисовки: страницы склеиваются и сортируются по времени. */
export function flattenThread(data: IThreadPages | undefined): TMessagesList {
  if (!data) return [];
  return sortMessagesChronologically<IMessageDto>(data.pages.flat());
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
  if (!hasMessage(data, messageId)) return data;

  return {
    ...data,
    pages: data.pages.map((page) =>
      page.map((message) => (message.id === messageId ? { ...message, ...patch } : message))
    ),
  };
}

export function removeMessage(data: IThreadPages, messageId: string): IThreadPages {
  if (!hasMessage(data, messageId)) return data;

  return {
    ...data,
    pages: data.pages.map((page) => page.filter((message) => message.id !== messageId)),
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
