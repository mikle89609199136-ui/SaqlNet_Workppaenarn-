import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { queryClient } from '@/shared/api';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { useServerEvents } from './useServerEvents';

const ME = 'user-me';
const GROUP = 'group-1';

function mount() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useServerEvents(true), { wrapper });
}

/* Смена ключа при смене состава группы (#806): ключ меняет любой участник,
   а не только владелец. Будет ли смена на самом деле, решает пометка на
   сервере — это проверяют тесты ChatKeyManager. */
describe('смена ключа при смене состава группы', () => {
  let rotate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(services.cryptoService, 'getAccountId').mockReturnValue(ME);
    rotate = vi
      .spyOn(services.cryptoService, 'rotateChatKeyIfNeeded')
      .mockResolvedValue({ chatKey: null, membersWithoutIdentity: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  it('рядовой участник меняет ключ, когда кто-то ушёл', async () => {
    mount();

    fakeSocket.emit('chat_member_removed', { chatId: GROUP, userId: 'user-x', reason: 'left' });

    await waitFor(() => expect(rotate).toHaveBeenCalledWith(GROUP));
  });

  it('меняет ключ, когда в группу добавили участника', async () => {
    mount();

    fakeSocket.emit('chat_member_added', { chatId: GROUP, member: { id: 'user-y' } });

    await waitFor(() => expect(rotate).toHaveBeenCalledWith(GROUP));
  });

  it('о своём уходе ключ не трогает', async () => {
    mount();

    fakeSocket.emit('chat_member_removed', { chatId: GROUP, userId: ME, reason: 'left' });
    // Событие о чужом чате того же рода — как маркер, что обработка прошла.
    fakeSocket.emit('chat_member_added', { chatId: 'group-2', member: { id: 'user-y' } });

    await waitFor(() => expect(rotate).toHaveBeenCalledWith('group-2'));
    expect(rotate).not.toHaveBeenCalledWith(GROUP);
  });

  it('ошибка смены ключа не роняет обработку событий', async () => {
    rotate.mockRejectedValueOnce(new Error('сеть'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount();

    fakeSocket.emit('chat_member_removed', { chatId: GROUP, userId: 'user-x', reason: 'kicked' });
    await waitFor(() => expect(warn).toHaveBeenCalled());

    fakeSocket.emit('chat_member_added', { chatId: 'group-2', member: { id: 'user-y' } });
    await waitFor(() => expect(rotate).toHaveBeenCalledWith('group-2'));
  });
});
