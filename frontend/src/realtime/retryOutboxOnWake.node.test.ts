import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services';
import { addOutboxItem, clearOutbox, resetInFlightForTests } from '@/entities/message';
import { makeMessage } from '@/test/fixtures';
import { startOutboxWakeRetry } from './retryOutboxOnWake';

/* Неотправленное досылается, когда вернулась сеть или вкладка, — и без
   переподключения сокета (#1069). */
describe('повтор очереди при пробуждении', () => {
  let listeners: Map<string, Array<() => void>>;
  let visibility: 'visible' | 'hidden';
  let online: boolean;

  const fire = (event: string) => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  const add = (type: string, handler: () => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), handler]);
  };
  const remove = (type: string, handler: () => void) => {
    listeners.set(
      type,
      (listeners.get(type) ?? []).filter((fn) => fn !== handler)
    );
  };

  beforeEach(() => {
    listeners = new Map();
    visibility = 'visible';
    online = true;
    clearOutbox();
    resetInFlightForTests();
    vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibility;
      },
      addEventListener: add,
      removeEventListener: remove,
    });
    vi.stubGlobal('navigator', {
      get onLine() {
        return online;
      },
    });
    addOutboxItem({
      senderId: 'user-1',
      tempId: 'temp-wake',
      chatId: 'chat-wake',
      content: 'не ушло',
      type: 'text',
      status: 'failed',
      createdAt: new Date(),
    });
  });

  afterEach(() => {
    clearOutbox();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function start() {
    const send = vi
      .spyOn(services.messageService, 'sendMessage')
      .mockResolvedValue(makeMessage({ id: 'server-wake' }));
    const stop = startOutboxWakeRetry(new QueryClient());
    return { send, stop };
  }

  it('сеть вернулась — неотправленное уходит', async () => {
    const { send, stop } = start();

    fire('online');

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    stop();
  });

  it('вкладка стала видимой — уходит; скрылась — нет', async () => {
    const { send, stop } = start();

    visibility = 'hidden';
    fire('visibilitychange');
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    visibility = 'visible';
    fire('visibilitychange');
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    stop();
  });

  it('без сети повтора нет', async () => {
    const { send, stop } = start();
    online = false;

    fire('online');
    fire('visibilitychange');
    await Promise.resolve();

    expect(send).not.toHaveBeenCalled();
    stop();
  });

  it('после остановки события ни на что не влияют', async () => {
    const { send, stop } = start();
    stop();

    fire('online');
    fire('visibilitychange');
    await Promise.resolve();

    expect(send).not.toHaveBeenCalled();
  });
});
