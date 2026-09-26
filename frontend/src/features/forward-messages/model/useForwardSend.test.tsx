import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { services } from '@/services';
import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import type { IMessageDto } from '@/types';
import { useForwardStore } from './forwardStore';
import { useForwardSend } from './useForwardSend';

const TARGET = 'chat-target';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

const at = (iso: string, content: string) =>
  makeMessage({ chatId: 'chat-source', content, createdAt: new Date(iso) });

/** Что ушло на сервер и в каком порядке. */
function recordSends(failOn?: string) {
  const sent: string[] = [];
  vi.spyOn(services.messageService, 'sendMessage').mockImplementation(async (chatId, content) => {
    if (failOn === 'comment') throw Object.assign(new Error('offline'), { status: 0 });
    sent.push(`комментарий: ${content}`);
    return makeMessage({ chatId, content });
  });
  vi.spyOn(services.messageService, 'forwardMessage').mockImplementation(
    async (message: IMessageDto, chatId: string) => {
      if (message.content === failOn) throw new Error('сбой сети');
      sent.push(`пересылка: ${message.content}`);
      return makeMessage({ chatId, content: message.content });
    }
  );
  return sent;
}

describe('отложенная пересылка (#93)', () => {
  beforeEach(() => {
    useForwardStore.getState().cancel();
    useChatUiStore.getState().resetChatState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('раскладывает выбранное в хронологическом порядке, а не в порядке кликов', () => {
    useForwardStore
      .getState()
      .start(TARGET, [
        at('2026-09-25T10:03:00Z', 'третье'),
        at('2026-09-25T10:01:00Z', 'первое'),
        at('2026-09-25T10:02:00Z', 'второе'),
      ]);

    expect(useForwardStore.getState().pending?.messages.map((m) => m.content)).toEqual([
      'первое',
      'второе',
      'третье',
    ]);
  });

  it('показывает пересылку только в том чате, куда её отправляют', () => {
    useForwardStore.getState().start(TARGET, [at('2026-09-25T10:01:00Z', 'первое')]);

    const other = renderHook(() => useForwardSend('chat-other'), { wrapper });
    const target = renderHook(() => useForwardSend(TARGET), { wrapper });

    expect(other.result.current.pending).toBeNull();
    expect(target.result.current.pending?.messages).toHaveLength(1);
  });

  it('отправляет комментарий первым, затем пересланные по порядку, и снимает плашку', async () => {
    const sent = recordSends();
    useForwardStore
      .getState()
      .start(TARGET, [at('2026-09-25T10:02:00Z', 'второе'), at('2026-09-25T10:01:00Z', 'первое')]);
    const { result } = renderHook(() => useForwardSend(TARGET), { wrapper });

    let outcome: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      outcome = await result.current.send('посмотри');
    });

    expect(sent).toEqual(['комментарий: посмотри', 'пересылка: первое', 'пересылка: второе']);
    expect(outcome).toEqual({ done: true, commentSent: true });
    expect(useForwardStore.getState().pending).toBeNull();
  });

  it('без комментария пересылает только сообщения', async () => {
    const sent = recordSends();
    useForwardStore.getState().start(TARGET, [at('2026-09-25T10:01:00Z', 'первое')]);
    const { result } = renderHook(() => useForwardSend(TARGET), { wrapper });

    await act(async () => {
      await result.current.send('');
    });

    expect(sent).toEqual(['пересылка: первое']);
  });

  it('при сбое на середине оставляет в плашке только неотправленное и говорит, сколько ушло', async () => {
    const sent = recordSends('второе');
    useForwardStore
      .getState()
      .start(TARGET, [
        at('2026-09-25T10:01:00Z', 'первое'),
        at('2026-09-25T10:02:00Z', 'второе'),
        at('2026-09-25T10:03:00Z', 'третье'),
      ]);
    const { result } = renderHook(() => useForwardSend(TARGET), { wrapper });

    let outcome: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      outcome = await result.current.send('посмотри');
    });

    expect(sent).toEqual(['комментарий: посмотри', 'пересылка: первое']);
    // Комментарий уже в чате — повтор его не продублирует.
    expect(outcome).toEqual({ done: false, commentSent: true });
    expect(useForwardStore.getState().pending?.messages.map((m) => m.content)).toEqual([
      'второе',
      'третье',
    ]);
    expect(useChatUiStore.getState().error).toMatch(/Переслано 1 из 3/);
  });

  it('если не ушёл даже комментарий, ничего не пересылает и сохраняет всё для повтора', async () => {
    const sent = recordSends('comment');
    useForwardStore.getState().start(TARGET, [at('2026-09-25T10:01:00Z', 'первое')]);
    const { result } = renderHook(() => useForwardSend(TARGET), { wrapper });

    let outcome: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      outcome = await result.current.send('посмотри');
    });

    expect(sent).toEqual([]);
    expect(outcome).toEqual({ done: false, commentSent: false });
    expect(useForwardStore.getState().pending?.messages).toHaveLength(1);
  });
});
