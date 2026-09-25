import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileStore } from '@/entities/user';
import { makeChat, makeMessage } from '@/test/fixtures';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
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
    useProfileStore.setState({ token: 'test-token' });
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
});
