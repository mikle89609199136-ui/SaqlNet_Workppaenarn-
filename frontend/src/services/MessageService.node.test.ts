import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '@/api/apiFactory';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { secretText } from '@/test/msw/plaintextGuard';
import type { IMessageDto } from '@/types';
import type { CryptoService } from './CryptoService';
import { MessageService } from './MessageService';

const TARGET_CHAT = 'chat-target';

function message(id: string, chatId: string, content: string): IMessageDto {
  return {
    id,
    chatId,
    senderId: 'user-1',
    content,
    type: 'text',
    createdAt: '2026-08-24T10:00:00Z',
  } as IMessageDto;
}

// Заглушка шифрования: содержимое проходит насквозь. Настоящая
// криптография проверяется в src/crypto/*.node.test.ts.
const passthroughCrypto = {
  decryptMessage: async (_chatId: string, content: string) => content,
  encryptMessage: async (_chatId: string, content: string) => content,
  ensureChatKey: async () => ({ chatKey: null, membersWithoutIdentity: [] }),
} as unknown as CryptoService;

function createService() {
  return new MessageService(createApiClient(), passthroughCrypto);
}

describe('MessageService: загрузка истории', () => {
  it('should ask the server for the requested page', async () => {
    let requestedUrl = '';
    server.use(
      http.get(api(`/messages/${TARGET_CHAT}`), ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ messages: [] });
      })
    );

    await createService().fetchMessagesPage(TARGET_CHAT, 50, 50);

    const params = new URL(requestedUrl).searchParams;
    expect(params.get('offset')).toBe('50');
    expect(params.get('limit')).toBe('50');
  });

  it('should return messages in chronological order', async () => {
    server.use(
      http.get(api(`/messages/${TARGET_CHAT}`), () =>
        HttpResponse.json({
          messages: [
            { ...message('newer', TARGET_CHAT, 'позже'), createdAt: '2026-08-24T12:00:00Z' },
            { ...message('older', TARGET_CHAT, 'раньше'), createdAt: '2026-08-24T10:00:00Z' },
          ],
        })
      )
    );

    const messages = await createService().fetchMessagesPage(TARGET_CHAT);

    expect(messages.map((item) => item.id)).toEqual(['older', 'newer']);
  });

  it('should return an empty list when the server has nothing', async () => {
    server.use(http.get(api(`/messages/${TARGET_CHAT}`), () => HttpResponse.json({})));

    expect(await createService().fetchMessagesPage(TARGET_CHAT)).toEqual([]);
  });
});

describe('MessageService: пересылка', () => {
  it('should send the message into the target chat as a new one', async () => {
    // Серверная пересылка копировала шифртекст исходного чата, а ключи у
    // чатов разные — в целевом такое сообщение не расшифровалось бы
    // никогда. Поэтому текст шифруется заново, ключом целевого чата.
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post(api(`/messages/${TARGET_CHAT}`), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ message: message('forwarded-1', TARGET_CHAT, 'переслано') });
      })
    );

    await createService().forwardMessage(
      message('source', 'chat-source', 'переслано'),
      TARGET_CHAT
    );

    expect(body).toMatchObject({ content: 'переслано', type: 'text' });
  });

  it('should refuse to forward what it could not read', async () => {
    // Пересылка идёт из ленты: если сообщение не расшифровалось, пересылать
    // нечего — уйдёт сама заглушка, и получатель увидит замок как текст.
    const unreadable = message('source', 'chat-source', '🔒 Ключ шифрования недоступен');

    await expect(createService().forwardMessage(unreadable, TARGET_CHAT)).rejects.toThrow(
      /не удалось расшифровать/
    );
  });
});

describe('MessageService: отметка о прочтении', () => {
  it('should confirm ids even when the chat was never loaded', async () => {
    server.use(http.post(api('/messages/read'), () => HttpResponse.json({ success: true })));

    const result = await createService().markAsRead(TARGET_CHAT, ['m-1', 'm-2']);

    expect(result.readIds).toEqual(['m-1', 'm-2']);
  });

  it('should send the chat and the messages to the server', async () => {
    let body: unknown = null;
    server.use(
      http.post(api('/messages/read'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true });
      })
    );

    await createService().markAsRead(TARGET_CHAT, ['m-1']);

    expect(body).toEqual({ chatId: TARGET_CHAT, messageIds: ['m-1'] });
  });
});

describe('сторож открытого текста', () => {
  it('should catch a plaintext body reaching the network', async () => {
    // Проверка самого сторожа: если он перестанет ловить утечку, это будет
    // видно здесь, а не в тот день, когда утечка случится по-настоящему.
    const secret = secretText('пароль');

    server.use(http.post(api('/probe'), () => HttpResponse.json({ ok: true })));
    await createApiClient().post('/probe', { note: secret });

    const { assertNoPlaintextLeaked } = await import('@/test/msw/plaintextGuard');
    expect(() => assertNoPlaintextLeaked()).toThrow(/Открытый текст ушёл на сервер/);
  });
});
