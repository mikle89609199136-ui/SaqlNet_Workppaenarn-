import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { chatKeys, useChatUiStore } from '@/entities/chat';
import { clearOutbox, getOutboxItem } from '@/entities/message';
import { services } from '@/services/serviceContainer';
import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { useSendVoiceMessage } from './useSendVoiceMessage';

const CHAT = 'chat-voice';
const recording = {
  blob: new Blob(['ogg'], { type: 'audio/ogg; codecs=opus' }),
  meta: { durationMs: 4200, waveform: [3, 31, 7] },
};

function mount() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(chatKeys.messages(CHAT), { pages: [[]], pageParams: [0] });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useSendVoiceMessage(CHAT), { wrapper }) };
}

const thread = (queryClient: QueryClient) =>
  (
    queryClient.getQueryData<{ pages: { id: string; voice?: unknown; status?: string }[][] }>(
      chatKeys.messages(CHAT)
    )?.pages ?? []
  ).flat();

/* Отправка голосового (#843): тем же путём, что вложения. */
describe('отправка голосового', () => {
  let send: MockInstance;

  afterEach(() => {
    send?.mockRestore();
    clearOutbox();
    useChatUiStore.setState({ replyToMessage: null, error: '' });
  });

  it('пузырь сразу в ленте с длительностью и волной, файл и метаданные — в отправку', async () => {
    send = vi
      .spyOn(services.messageService, 'sendMediaMessage')
      .mockResolvedValue(makeMessage({ id: 'srv-voice', chatId: CHAT, type: 'voice' }) as never);
    const reply = makeMessage({ id: 'm-reply', chatId: CHAT });
    useChatUiStore.setState({ replyToMessage: reply });
    const { result, queryClient } = mount();

    act(() => result.current(recording));

    const optimistic = thread(queryClient).find((message) => message.id.startsWith('temp-'));
    expect(optimistic).toMatchObject({ voice: recording.meta, status: 'uploading' });
    // Ответ уехал вместе с голосовым, поле ответа очищено.
    expect(useChatUiStore.getState().replyToMessage).toBeNull();

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        CHAT,
        recording.blob,
        'voice',
        '',
        'm-reply',
        [],
        recording.meta
      )
    );
    await waitFor(() => expect(thread(queryClient).some((m) => m.id === 'srv-voice')).toBe(true));
  });

  it('сбой отправки — «не отправлено», голосовое остаётся в очереди для повтора', async () => {
    send = vi
      .spyOn(services.messageService, 'sendMediaMessage')
      .mockRejectedValue(Object.assign(new Error('сеть'), { code: 'network' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, queryClient } = mount();

    try {
      act(() => result.current(recording));

      await waitFor(() =>
        expect(thread(queryClient)[0]).toMatchObject({ status: 'failed', voice: recording.meta })
      );
      expect(getOutboxItem(thread(queryClient)[0].id)).toMatchObject({ voice: recording.meta });
      expect(useChatUiStore.getState().error).not.toBe('');
    } finally {
      warn.mockRestore();
    }
  });
});
