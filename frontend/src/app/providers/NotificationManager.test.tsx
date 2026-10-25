import { act, render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userKeys, useProfileStore } from '@/entities/user';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { usePushStore } from '@/features/push-notifications';
import { queryClient } from '@/shared/api';
import { services } from '@/services/serviceContainer';
import { NotificationManager } from './NotificationManager';

const chat = makeChat();

// Так выглядит содержимое сообщения на проводе: расшифровка ещё не выполнена.
const CIPHERTEXT = JSON.stringify({
  e2e: true,
  iv: 'ddvFHbebFfMGjv9H',
  data: 'da317qLQY9FRE3N/zfvTsqHa9V3tM+Jo6epBrgFHWB9geZRk',
  senderPublicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE',
  senderKeyFp: 'OAKoAWB4L3jx',
});

function notificationCalls() {
  return (Notification as unknown as ReturnType<typeof vi.fn>).mock.calls;
}

describe('системные уведомления', () => {
  beforeEach(() => {
    // Notification — общая заглушка из тестового setup: вызовы прошлых
    // тестов остались бы в ней и сбили счёт.
    (Notification as unknown as ReturnType<typeof vi.fn>).mockClear();
    useProfileStore.setState({ isAuth: true, user: makeUser({ id: 'viewer' }) });
    queryClient.setQueryData(userKeys.settings(), {
      settings: { notifications: true, sounds: true, callSounds: true },
      privacy: {},
    });
    // Уведомление показывается только при скрытой вкладке.
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    server.use(http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should never put ciphertext into the notification body', async () => {
    render(<NotificationManager />);

    fakeSocket.emit('new_message', {
      message: makeMessage({ chatId: chat.id, content: CIPHERTEXT, senderName: 'Алиса' }),
      chatId: chat.id,
    });

    await waitFor(() => expect(notificationCalls()).toHaveLength(1));

    const body = String(notificationCalls()[0][1]?.body ?? '');
    expect(body).not.toContain('"e2e"');
    expect(body).not.toContain('iv');
    expect(body).not.toContain(CIPHERTEXT.slice(0, 30));
  });

  it('should show a readable body for an unencrypted message', async () => {
    render(<NotificationManager />);

    fakeSocket.emit('new_message', {
      message: makeMessage({ chatId: chat.id, content: 'привет', senderName: 'Алиса' }),
      chatId: chat.id,
    });

    await waitFor(() => expect(notificationCalls()).toHaveLength(1));

    expect(notificationCalls()[0][0]).toBe('Алиса');
    expect(String(notificationCalls()[0][1]?.body)).toBe('привет');
  });

  it('скрывает текст только выбранного чата и позволяет включить его обратно', async () => {
    let hidden = true;
    server.use(
      http.get(api('/chats/:chatId'), ({ params }) =>
        HttpResponse.json({
          chat: { ...chat, hideNotificationPreview: params.chatId === chat.id && hidden },
        })
      )
    );
    render(<NotificationManager />);

    const emit = (chatId: string) =>
      fakeSocket.emit('new_message', {
        message: makeMessage({ chatId, content: 'секрет', senderName: 'Алиса' }),
        chatId,
      });
    emit(chat.id);
    await waitFor(() => expect(notificationCalls()).toHaveLength(1));
    expect(notificationCalls()[0][0]).toBe('Алиса');
    expect(notificationCalls()[0][1].body).toBe('Новое сообщение');

    emit('another-chat');
    await waitFor(() => expect(notificationCalls()).toHaveLength(2));
    expect(notificationCalls()[1][1].body).toBe('секрет');

    hidden = false;
    emit(chat.id);
    await waitFor(() => expect(notificationCalls()).toHaveLength(3));
    expect(notificationCalls()[2][1].body).toBe('секрет');
  });

  it.each(['hidden', 'unavailable'] as const)(
    'после расшифровки скрывает текст, если настройка стала %s',
    async (outcome) => {
      let finishDecryption!: () => void;
      const decryption = new Promise<void>((resolve) => {
        finishDecryption = resolve;
      });
      const decrypt = vi
        .spyOn(services.messageService, 'processLastMessageForDisplay')
        .mockImplementation(async (_chatId, message) => {
          await decryption;
          return { ...message, content: 'секрет' };
        });
      let changed = false;
      let reads = 0;
      server.use(
        http.get(api('/chats/:chatId'), () => {
          reads++;
          if (changed && outcome === 'unavailable') return new HttpResponse(null, { status: 500 });
          return HttpResponse.json({ chat: { ...chat, hideNotificationPreview: changed } });
        })
      );
      render(<NotificationManager />);
      fakeSocket.emit('new_message', {
        message: makeMessage({ chatId: chat.id, content: CIPHERTEXT }),
        chatId: chat.id,
      });

      await waitFor(() => expect(decrypt).toHaveBeenCalledOnce());
      expect(reads).toBe(1);
      expect(notificationCalls()).toHaveLength(0);
      // Другое устройство сохраняет настройку, пока первое расшифровывает сообщение.
      changed = true;
      await act(async () => finishDecryption());

      await waitFor(() => expect(reads).toBe(2));
      if (outcome === 'hidden') {
        await waitFor(() => expect(notificationCalls()).toHaveLength(1));
        expect(notificationCalls()[0][1].body).toBe('Новое сообщение');
      } else {
        await act(async () => undefined);
        expect(notificationCalls()).toHaveLength(0);
      }
    }
  );

  it('не оповещает, если mute/preview не удалось получить', async () => {
    const read = vi.spyOn(services.chatService, 'getChat').mockRejectedValue(new Error('offline'));
    render(<NotificationManager />);
    fakeSocket.emit('new_message', {
      message: makeMessage({ chatId: chat.id, content: 'секрет' }),
      chatId: chat.id,
    });
    await waitFor(() => expect(read).toHaveBeenCalled());
    await act(async () => undefined);
    expect(notificationCalls()).toHaveLength(0);
  });

  it('should stay silent while the tab is visible', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    render(<NotificationManager />);

    fakeSocket.emit('new_message', {
      message: makeMessage({ chatId: chat.id, content: 'привет' }),
      chatId: chat.id,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notificationCalls()).toHaveLength(0);
  });

  // #882: разрешение — только по нажатию (плашка, настройки), не при загрузке.
  it('не спрашивает разрешение при загрузке', () => {
    const request = vi.spyOn(Notification, 'requestPermission');
    render(<NotificationManager />);
    expect(request).not.toHaveBeenCalled();
  });

  // Push включён — уведомление покажет service worker, второе было бы дублем.
  it('при включённом push не дублирует уведомление из вкладки', async () => {
    render(<NotificationManager />);
    // Синхронизация push при входе отработала (в тестах — «не поддерживается»),
    // дальше — как на устройстве, где push включён.
    await act(async () => undefined);
    act(() => usePushStore.setState({ status: 'on', subscriptionId: 'sub-1', busy: false }));

    fakeSocket.emit('new_message', {
      message: makeMessage({ chatId: chat.id, content: 'привет' }),
      chatId: chat.id,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notificationCalls()).toHaveLength(0);
    usePushStore.setState({ status: 'off', subscriptionId: null });
  });
});

describe('переход по нажатию на push', () => {
  const listeners: ((event: MessageEvent) => void)[] = [];

  beforeEach(() => {
    listeners.length = 0;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
          listeners.push(listener),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    window.history.pushState(null, '', '/');
  });

  it('открывает чат внутри приложения; чужие адреса игнорирует', () => {
    render(<NotificationManager />);
    const popstate = vi.fn();
    window.addEventListener('popstate', popstate);

    listeners.forEach((listener) =>
      listener({ data: { type: 'craneapp:navigate', url: '/chats/c1' } } as MessageEvent)
    );
    expect(window.location.pathname).toBe('/chats/c1');
    expect(popstate).toHaveBeenCalledTimes(1);

    for (const url of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)']) {
      listeners.forEach((listener) =>
        listener({ data: { type: 'craneapp:navigate', url } } as MessageEvent)
      );
    }
    expect(window.location.pathname).toBe('/chats/c1');
    expect(popstate).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', popstate);
  });
});
