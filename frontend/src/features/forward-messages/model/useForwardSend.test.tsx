import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { MAX_MESSAGES_PER_SEND } from '@/shared/config';
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

/** Какими пачками ушла пересылка: комментарий и содержимое пересланных. */
function recordBatches(failOn?: string) {
  const batches: Array<{ comment: string; messages: string[] }> = [];
  vi.spyOn(services.messageService, 'forwardMessages').mockImplementation(
    async (chatId: string, originals: IMessageDto[], comment = '') => {
      // Пачка — всё или ничего: сбой одного сообщения не пропускает и остальные.
      if (originals.some((message) => message.content === failOn)) throw new Error('сбой сети');
      batches.push({ comment, messages: originals.map((message) => message.content) });
      return [
        ...(comment ? [makeMessage({ chatId, content: comment })] : []),
        ...originals.map((message) => makeMessage({ chatId, content: message.content })),
      ];
    }
  );
  return batches;
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

  it('отправляет комментарий и пересланные одной пачкой, по порядку, и снимает плашку', async () => {
    const batches = recordBatches();
    useForwardStore
      .getState()
      .start(TARGET, [at('2026-09-25T10:02:00Z', 'второе'), at('2026-09-25T10:01:00Z', 'первое')]);
    const { result } = renderHook(() => useForwardSend(TARGET), { wrapper });

    let outcome: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      outcome = await result.current.send('посмотри');
    });

    expect(batches).toEqual([{ comment: 'посмотри', messages: ['первое', 'второе'] }]);
    expect(outcome).toEqual({ done: true, commentSent: true });
    expect(useForwardStore.getState().pending).toBeNull();
  });

  it('без комментария пересылает только сообщения', async () => {
    const batches = recordBatches();
    useForwardStore.getState().start(TARGET, [at('2026-09-25T10:01:00Z', 'первое')]);
    const { result } = renderHook(() => useForwardSend(TARGET), { wrapper });

    await act(async () => {
      await result.current.send('');
    });

    expect(batches).toEqual([{ comment: '', messages: ['первое'] }]);
  });

  it('при сбое не уходит ничего: всё остаётся в плашке для повтора, комментарий — в поле', async () => {
    const batches = recordBatches('второе');
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

    expect(batches).toEqual([]);
    // Комментарий не ушёл — его вернут в поле, и повтор отправит всё заново.
    expect(outcome).toEqual({ done: false, commentSent: false });
    expect(useForwardStore.getState().pending?.messages).toHaveLength(3);
    expect(useChatUiStore.getState().error).not.toMatch(/Переслано/);
  });

  it('полная сотня с комментарием уходит двумя пачками, и сбой второй оставляет только её', async () => {
    const messages = Array.from({ length: MAX_MESSAGES_PER_SEND }, (_, index) =>
      at(new Date(Date.UTC(2026, 8, 25, 10, 0, index)).toISOString(), `m${index}`)
    );
    const last = `m${MAX_MESSAGES_PER_SEND - 1}`;
    const batches = recordBatches(last);
    useForwardStore.getState().start(TARGET, messages);
    const { result } = renderHook(() => useForwardSend(TARGET), { wrapper });

    let outcome: Awaited<ReturnType<typeof result.current.send>> | undefined;
    await act(async () => {
      outcome = await result.current.send('посмотри');
    });

    // Комментарий занял место в первой пачке: в неё вошли 99 пересланных.
    expect(batches).toHaveLength(1);
    expect(batches[0].comment).toBe('посмотри');
    expect(batches[0].messages).toHaveLength(MAX_MESSAGES_PER_SEND - 1);
    // Комментарий уже в чате — повтор его не продублирует.
    expect(outcome).toEqual({ done: false, commentSent: true });
    expect(useForwardStore.getState().pending?.messages.map((m) => m.content)).toEqual([last]);
    expect(useChatUiStore.getState().error).toMatch(
      new RegExp(`Переслано ${MAX_MESSAGES_PER_SEND - 1} из ${MAX_MESSAGES_PER_SEND}`)
    );
  });
});
