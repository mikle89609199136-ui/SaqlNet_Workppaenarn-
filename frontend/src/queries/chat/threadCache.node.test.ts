import { describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import {
  appendMessage,
  canAppendToThread,
  flattenThread,
  patchMessage,
  removeMessage,
  type IThreadPages,
} from './threadCache';

function pages(...groups: ReturnType<typeof makeMessage>[][]): IThreadPages {
  return { pages: groups, pageParams: groups.map((_, index) => index * 50) };
}

describe('склейка страниц истории', () => {
  it('should return an empty list without data', () => {
    expect(flattenThread(undefined)).toEqual([]);
  });

  it('should order messages chronologically across pages', () => {
    const older = makeMessage();
    const newer = makeMessage();
    // Свежая страница приходит первой, старая — второй: в ленте порядок обратный.
    const data = pages([newer], [older]);

    expect(flattenThread(data).map((message) => message.id)).toEqual([older.id, newer.id]);
  });
});

describe('добавление сообщения', () => {
  it('should append to the freshest page', () => {
    const existing = makeMessage();
    const arrived = makeMessage();

    const next = appendMessage(pages([existing]), arrived);

    expect(next.pages[0].map((message) => message.id)).toEqual([existing.id, arrived.id]);
  });

  it('should ignore a message that is already there', () => {
    // Сообщение приходит дважды: ответом на отправку и эхом по WebSocket.
    const message = makeMessage();
    const data = pages([message]);

    const next = appendMessage(data, message);

    expect(next).toBe(data);
    expect(flattenThread(next)).toHaveLength(1);
  });

  it('should look for duplicates across every page', () => {
    const message = makeMessage();
    const data = pages([makeMessage()], [message]);

    expect(flattenThread(appendMessage(data, message))).toHaveLength(2);
  });
});

describe('изменение сообщения', () => {
  it('should patch the message wherever it lies', () => {
    const target = makeMessage({ content: 'до' });
    const data = pages([makeMessage()], [target]);

    const next = patchMessage(data, target.id, { content: 'после', isEdited: true });
    const patched = flattenThread(next).find((message) => message.id === target.id);

    expect(patched?.content).toBe('после');
    expect(patched?.isEdited).toBe(true);
  });

  it('should keep the same object for an unknown message', () => {
    // Отсутствие изменений важно возвращать той же ссылкой: иначе подписчики
    // перерисуются на событие, которое их не касается.
    const data = pages([makeMessage()]);

    expect(patchMessage(data, 'нет-такого', { content: 'x' })).toBe(data);
  });
});

describe('удаление сообщения', () => {
  it('should drop the message from its page', () => {
    const kept = makeMessage();
    const removed = makeMessage();

    const next = removeMessage(pages([kept, removed]), removed.id);

    expect(flattenThread(next).map((message) => message.id)).toEqual([kept.id]);
  });

  it('should keep the same object for an unknown message', () => {
    const data = pages([makeMessage()]);

    expect(removeMessage(data, 'нет-такого')).toBe(data);
  });
});

describe('можно ли дописывать в кеш', () => {
  it('should refuse when the thread was never loaded', () => {
    // Дефект #174: запись из одного сообщения принималась за всю историю,
    // и чат открывался почти пустым.
    expect(canAppendToThread(undefined)).toBe(false);
    expect(canAppendToThread({ pages: [], pageParams: [] })).toBe(false);
  });

  it('should allow appending to a loaded thread', () => {
    expect(canAppendToThread(pages([]))).toBe(true);
    expect(canAppendToThread(pages([makeMessage()]))).toBe(true);
  });
});
