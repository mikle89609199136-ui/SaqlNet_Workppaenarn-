import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import { chatKeys } from '../keys';
import {
  dropThreadMessage,
  markThreadRead,
  patchThreadMessage,
  putThreadMessage,
} from './threadCacheActions';
import { flattenThread, type IThreadPages } from './threadCache';

const CHAT_ID = 'chat-1';

let queryClient: QueryClient;
let invalidated: string[][];

/** Ключи, по которым запрашивали перезагрузку. */
function seedThread(messages = [makeMessage({ id: 'm-1' })]) {
  queryClient.setQueryData<IThreadPages>(chatKeys.messages(CHAT_ID), {
    pages: [messages],
    pageParams: [0],
  });
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidated = [];

  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters: any) => {
    invalidated.push(filters?.queryKey as string[]);
    return Promise.resolve();
  });
});

describe('запись сообщения в тред', () => {
  it('should mark the chat list as stale when a message arrives', () => {
    // Превью в списке чатов — то же самое сообщение, показанное в другом
    // месте. Раньше их связывал отдельный хук со своими подписками, и
    // отправленное сообщение появлялось в ленте, но не в списке.
    seedThread();

    putThreadMessage(queryClient, CHAT_ID, makeMessage({ id: 'm-2' }));

    expect(invalidated).toContainEqual(chatKeys.list());
  });

  it('should not refetch the thread it just appended to', () => {
    // Ключ чата — префикс ключа его истории: инвалидация по нему тут же
    // стёрла бы только что дописанное сообщение.
    seedThread();

    putThreadMessage(queryClient, CHAT_ID, makeMessage({ id: 'm-2' }));

    expect(invalidated).not.toContainEqual(chatKeys.messages(CHAT_ID));
    expect(
      flattenThread(queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT_ID))).map(
        (message) => message.id
      )
    ).toEqual(['m-1', 'm-2']);
  });

  it('should refetch instead of appending to a thread that was never loaded', () => {
    // Одно сообщение было бы принято за всю историю чата (#174).
    putThreadMessage(queryClient, CHAT_ID, makeMessage({ id: 'm-1' }));

    expect(invalidated).toContainEqual(chatKeys.messages(CHAT_ID));
    expect(invalidated).toContainEqual(chatKeys.list());
  });
});

describe('отметка прочитанным', () => {
  it('should mark the chat list as stale so the unread badge clears', () => {
    // Счётчик непрочитанных живёт в списке чатов, а не в ленте: пока его
    // никто не помечал устаревшим, бейдж висел до перезагрузки страницы.
    seedThread([makeMessage({ id: 'm-1', isRead: false })]);

    markThreadRead(queryClient, CHAT_ID, ['m-1']);

    expect(invalidated).toContainEqual(chatKeys.list());
  });

  it('should mark only the confirmed messages as read', () => {
    seedThread([
      makeMessage({ id: 'm-1', isRead: false }),
      makeMessage({ id: 'm-2', isRead: false }),
    ]);

    markThreadRead(queryClient, CHAT_ID, ['m-1']);

    const thread = flattenThread(
      queryClient.getQueryData<IThreadPages>(chatKeys.messages(CHAT_ID))
    );
    expect(thread.find((message) => message.id === 'm-1')?.isRead).toBe(true);
    expect(thread.find((message) => message.id === 'm-2')?.isRead).toBe(false);
  });

  it('should survive an empty thread', () => {
    // Событие о прочтении может прийти по чату, историю которого не грузили.
    expect(() => markThreadRead(queryClient, CHAT_ID, ['m-1'])).not.toThrow();
  });
});

describe('правка и удаление', () => {
  it('should mark the chat list as stale when a message is edited', () => {
    // Отредактированным может оказаться последнее сообщение чата.
    seedThread();

    patchThreadMessage(queryClient, CHAT_ID, 'm-1', { content: 'другой текст' });

    expect(invalidated).toContainEqual(chatKeys.list());
  });

  it('should mark pins and the chat list as stale when a message is deleted', () => {
    seedThread();

    dropThreadMessage(queryClient, CHAT_ID, 'm-1');

    expect(invalidated).toContainEqual(chatKeys.pins(CHAT_ID));
    expect(invalidated).toContainEqual(chatKeys.list());
  });
});
