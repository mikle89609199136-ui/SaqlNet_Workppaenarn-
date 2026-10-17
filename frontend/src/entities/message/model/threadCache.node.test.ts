import { describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import {
  appendMessage,
  applyReceipt,
  canAppendToThread,
  flattenThread,
  forgetReplyPreviews,
  patchMessage,
  removeMessage,
  replaceMessage,
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

  /* Страница по смещению после новых сообщений начинается с тех, что уже
     лежат в первой (#1064). */
  it('сообщение с двух страниц попадает в ленту один раз', () => {
    const older = makeMessage();
    const shared = makeMessage();
    const newer = makeMessage();

    const ids = flattenThread(pages([shared, newer], [older, shared])).map((m) => m.id);

    expect(ids).toEqual([older.id, shared.id, newer.id]);
  });

  it('из двух копий остаётся правленная позже, на какой бы странице она ни была', () => {
    const base = makeMessage({ content: 'до правки', updatedAt: new Date('2026-10-17T10:00:00Z') });
    const edited = {
      ...base,
      content: 'после правки',
      updatedAt: new Date('2026-10-17T10:05:00Z'),
    };

    expect(flattenThread(pages([base], [edited]))[0].content).toBe('после правки');
    expect(flattenThread(pages([edited], [base]))[0].content).toBe('после правки');
  });

  it('при равной правке остаётся копия из первой страницы', () => {
    const shown = makeMessage({
      updatedAt: new Date('2026-10-17T10:00:00Z'),
      reactions: [{ emoji: '👍', count: 1, myReaction: true }],
    });
    const stale = { ...shown, reactions: [] };

    expect(flattenThread(pages([shown], [stale]))[0].reactions).toHaveLength(1);
  });

  it('пустые страницы дают пустой список', () => {
    expect(flattenThread(pages([], []))).toEqual([]);
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
  // Превью исходника пришло с ответом: после удаления у всех оно не должно
  // оставаться в цитате (#1065).
  it('снимает превью цитаты у ответов на удалённое', () => {
    const preview = {
      id: 'msg-old',
      content: 'удалённый текст',
      type: 'text' as const,
      senderId: 'user-2',
      senderName: 'Анна',
      reactions: [],
    };
    const reply = makeMessage({ replyTo: 'msg-old', replyPreview: preview });
    const other = makeMessage({
      replyTo: 'msg-kept',
      replyPreview: { ...preview, id: 'msg-kept' },
    });
    const data = pages([reply, other]);

    const next = forgetReplyPreviews(data, ['msg-old']);
    const [first, second] = flattenThread(next);

    expect(first.replyPreview).toBeUndefined();
    expect(second.replyPreview?.id).toBe('msg-kept');
    expect(forgetReplyPreviews(data, ['msg-unknown'])).toBe(data);
  });

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

describe('замена сообщения (Outbox оптимистичный ID -> серверный ID)', () => {
  it('should replace optimistic message with confirmed server message', () => {
    const tempMsg = makeMessage({ id: 'temp-123', content: 'отправка...', status: 'pending' });
    const realMsg = makeMessage({ id: 'server-999', content: 'отправлено!', status: 'sent' });
    const otherMsg = makeMessage();

    const data = pages([tempMsg, otherMsg]);
    const next = replaceMessage(data, 'temp-123', realMsg);

    const ids = flattenThread(next).map((m) => m.id);
    expect(ids).toContain('server-999');
    expect(ids).not.toContain('temp-123');
  });

  it('should append message if target temp message was not found', () => {
    const realMsg = makeMessage({ id: 'server-999' });
    const data = pages([makeMessage()]);

    const next = replaceMessage(data, 'non-existent', realMsg);
    expect(flattenThread(next).map((m) => m.id)).toContain('server-999');
  });

  it('should remove temp message and avoid duplication if replacement already in cache', () => {
    const tempMsg = makeMessage({ id: 'temp-123' });
    const realMsg = makeMessage({ id: 'server-999' });
    const data = pages([tempMsg, realMsg]);

    const next = replaceMessage(data, 'temp-123', realMsg);
    const ids = flattenThread(next).map((m) => m.id);
    expect(ids).toEqual(['server-999']);
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

describe('галочки по событию receipts (#657)', () => {
  const me = 'user-1';
  const peer = 'user-2';
  const at = '2026-09-29T12:05:00.000Z';
  const mine = (createdAt: string, extra: Parameters<typeof makeMessage>[0] = {}) =>
    makeMessage({ senderId: me, createdAt: new Date(createdAt), ...extra });

  it('свои до границы получают время, более новые и чужие — нет', () => {
    const before = mine('2026-09-29T12:00:00.000Z');
    const onBoundary = mine('2026-09-29T12:01:00.000Z');
    const after = mine('2026-09-29T12:02:00.000Z');
    const peers = makeMessage({ senderId: peer, createdAt: new Date('2026-09-29T11:00:00.000Z') });

    const next = applyReceipt(pages([before, onBoundary, after, peers]), {
      chatId: 'chat-1',
      userId: peer,
      kind: 'read',
      upTo: '2026-09-29T12:01:00.000Z',
      at,
    });

    const [b, o, a, p] = next.pages[0];
    expect([b.readAt, b.deliveredAt]).toEqual([at, at]);
    expect([o.readAt, o.deliveredAt]).toEqual([at, at]);
    expect([a.readAt, a.deliveredAt]).toEqual([undefined, undefined]);
    expect(p.readAt).toBeUndefined();
  });

  it('время первого прочтения не перезаписывается повтором', () => {
    const first = '2026-09-29T12:00:30.000Z';
    const message = mine('2026-09-29T12:00:00.000Z', { readAt: first, deliveredAt: first });
    const data = pages([message]);

    const next = applyReceipt(data, {
      chatId: 'chat-1',
      userId: peer,
      kind: 'read',
      upTo: '2026-09-29T12:10:00.000Z',
      at,
    });

    expect(next).toBe(data);
  });

  it('сообщения из очереди отправки граница не переходит', () => {
    const pending = mine('2026-09-29T12:00:00.000Z', { status: 'pending', tempId: 'tmp-1' });
    const failed = mine('2026-09-29T12:00:00.000Z', { status: 'failed' });
    const data = pages([pending, failed]);

    expect(
      applyReceipt(data, {
        chatId: 'chat-1',
        userId: peer,
        kind: 'delivered',
        upTo: '2026-09-29T13:00:00.000Z',
        at,
      })
    ).toBe(data);
  });
});
