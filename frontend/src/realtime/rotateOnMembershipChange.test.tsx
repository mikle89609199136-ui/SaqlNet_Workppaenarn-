import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatKeys } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { queryClient } from '@/shared/api';
import { makeChat } from '@/test/fixtures';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { useServerEvents } from './useServerEvents';

const ME = 'user-me';
const GROUP = 'group-1';

/* Кеш — общий кеш приложения: из него же читает шифрование, и отдельный
   клиент в тесте спрятал бы именно ту устаревшую запись, о которой речь. */
function mount() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useServerEvents(true), { wrapper });
}

const spyOnRotate = () =>
  vi
    .spyOn(services.cryptoService, 'rotateChatKey')
    .mockResolvedValue({ chatKey: null, membersWithoutIdentity: [] });

describe('смена ключа при смене состава группы', () => {
  let rotate: ReturnType<typeof spyOnRotate>;
  let chatRequests: number;

  beforeEach(() => {
    chatRequests = 0;
    vi.spyOn(services.cryptoService, 'getAccountId').mockReturnValue(ME);
    rotate = spyOnRotate();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  function serveOwner(ownerId: string) {
    server.use(
      http.get(api('/chats/:chatId'), ({ params }) => {
        chatRequests += 1;
        return HttpResponse.json({
          chat: makeChat({ id: String(params.chatId), type: 'group', ownerId }),
        });
      })
    );
  }

  it('владелец, которому только что передали группу, меняет ключ после ухода прежнего', async () => {
    // В кеше прежний владелец: о передаче прав сервер не сообщает (#105).
    queryClient.setQueryData(
      chatKeys.detail(GROUP),
      makeChat({ id: GROUP, type: 'group', ownerId: 'user-old' })
    );
    serveOwner(ME);
    mount();

    fakeSocket.emit('chat_member_removed', { chatId: GROUP, userId: 'user-old', reason: 'left' });

    await waitFor(() => expect(rotate).toHaveBeenCalledWith(GROUP));
  });

  it('рядовой участник ключ не меняет', async () => {
    serveOwner('user-other');
    mount();

    fakeSocket.emit('chat_member_removed', { chatId: GROUP, userId: 'user-x', reason: 'left' });

    await waitFor(() => expect(chatRequests).toBe(1));
    expect(rotate).not.toHaveBeenCalled();
  });

  it('о своём уходе не спрашивает сервер и ключ не трогает', async () => {
    serveOwner(ME);
    mount();

    fakeSocket.emit('chat_member_removed', { chatId: GROUP, userId: ME, reason: 'left' });
    // Событие о чужом чате того же рода — как маркер, что обработка прошла.
    fakeSocket.emit('chat_member_added', { chatId: 'group-2', member: { id: 'user-y' } });

    await waitFor(() => expect(rotate).toHaveBeenCalledWith('group-2'));
    expect(rotate).not.toHaveBeenCalledWith(GROUP);
    expect(chatRequests).toBe(1);
  });
});
