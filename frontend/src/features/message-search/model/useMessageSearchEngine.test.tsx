import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { makeMessage } from '@/test/fixtures';
import type { IMessageDto } from '@/types';
import { useMessageSearchStore } from './messageSearchStore';
import { useMessageSearchEngine } from './useMessageSearchEngine';

const loaded = [makeMessage({ id: 'fresh', content: 'новое' })];
const old = makeMessage({ id: 'old', content: 'релиз' });
const state = () => useMessageSearchStore.getState();

function startSearch() {
  act(() => {
    state().open('chat-1');
    state().setQuery('релиз');
  });
}

afterEach(() => vi.restoreAllMocks());

it('после закрытия и повторного открытия не возвращает старую историю до ответа сервера', async () => {
  const read = vi
    .spyOn(services.messageService, 'fetchMessageTextsPage')
    .mockResolvedValueOnce([old]);
  renderHook(() =>
    useMessageSearchEngine({ chatId: 'chat-1', loadedMessages: loaded, hasOlder: true })
  );
  startSearch();
  await waitFor(() => expect(state().results.map(({ id }) => id)).toEqual(['old']));
  act(() => state().close());

  let respond!: (messages: IMessageDto[]) => void;
  read.mockImplementationOnce(() => new Promise((resolve) => (respond = resolve)));
  startSearch();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(state()).toMatchObject({ results: [], historyStatus: 'loading' });

  await act(async () => respond([]));
  await waitFor(() => expect(state()).toMatchObject({ results: [], historyStatus: 'complete' }));
});

it('при смене чата выбрасывает прежнюю историю, даже если вернуться в тот же чат', async () => {
  const read = vi
    .spyOn(services.messageService, 'fetchMessageTextsPage')
    .mockResolvedValueOnce([old])
    .mockResolvedValue([]);
  const { rerender } = renderHook(
    ({ chatId }) => useMessageSearchEngine({ chatId, loadedMessages: loaded, hasOlder: true }),
    { initialProps: { chatId: 'chat-1' } }
  );
  startSearch();
  await waitFor(() => expect(state().results).toHaveLength(1));
  act(() => state().close());
  rerender({ chatId: 'chat-2' });
  rerender({ chatId: 'chat-1' });
  startSearch();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(state()).toMatchObject({ results: [], historyStatus: 'complete' }));
});

it('догруженные в ленту сообщения не увеличивают число просмотренных повторно', async () => {
  vi.spyOn(services.messageService, 'fetchMessageTextsPage').mockResolvedValue([old]);
  const { rerender } = renderHook(
    ({ messages }) =>
      useMessageSearchEngine({ chatId: 'chat-1', loadedMessages: messages, hasOlder: true }),
    { initialProps: { messages: loaded } }
  );
  startSearch();
  await waitFor(() => expect(state().scannedCount).toBe(2));
  rerender({ messages: [...loaded, old] });
  expect(state().scannedCount).toBe(2);
});
