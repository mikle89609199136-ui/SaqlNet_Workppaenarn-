import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
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

// Заглушка шифрования: контент проходит насквозь. Настоящая криптография
// проверяется в CryptoService.node.test.ts — здесь важна работа с историей.
const passthroughCrypto = {
  decryptDM: async (content: string) => content,
  decryptGroup: async (_chatId: string, content: string) => content,
  encryptDM: async (content: string) => content,
  encryptGroup: async (_chatId: string, content: string) => content,
} as unknown as CryptoService;

function createService() {
  return new MessageService(createApiClient(), passthroughCrypto);
}

/** Сервер отдаёт заданную историю и подтверждает пересылку. */
function serveHistory(history: IMessageDto[]) {
  server.use(
    http.get(api(`/messages/${TARGET_CHAT}`), () => HttpResponse.json({ messages: history })),
    http.post(api('/messages/:messageId/forward'), () =>
      HttpResponse.json({ message: message('forwarded-1', TARGET_CHAT, 'переслано') })
    )
  );
}

describe('MessageService: история чата', () => {
  let service: MessageService;

  beforeEach(() => {
    serveHistory([
      message('old-1', TARGET_CHAT, 'первое'),
      message('old-2', TARGET_CHAT, 'второе'),
    ]);
    service = createService();
  });

  it('should request history from the server on first open', async () => {
    let requestedUrl = '';
    server.use(
      http.get(api(`/messages/${TARGET_CHAT}`), ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ messages: [] });
      })
    );

    await service.getMessages(TARGET_CHAT);

    expect(new URL(requestedUrl).searchParams.get('offset')).toBe('0');
  });

  it('should keep the target chat history after forwarding into it', async () => {
    // Регрессия #174: пересылка в чат, который в этой сессии не открывали,
    // подменяла всю его историю одним пересланным сообщением.
    await service.forwardMessage('source-message', TARGET_CHAT);

    const ids = (await service.getMessages(TARGET_CHAT)).map((item) => item.id);

    expect(ids).toContain('old-1');
    expect(ids).toContain('old-2');
  });

  it('should keep both history and the forwarded message when the chat was open', async () => {
    await service.getMessages(TARGET_CHAT);
    await service.forwardMessage('source-message', TARGET_CHAT);

    const ids = (await service.getMessages(TARGET_CHAT)).map((item) => item.id);

    expect(ids).toContain('old-1');
    expect(ids).toContain('old-2');
    expect(ids).toContain('forwarded-1');
  });
});

describe('MessageService: пересылка', () => {
  it('should send the target chat in the request body', async () => {
    let body: unknown = null;
    server.use(
      http.post(api('/messages/source-message/forward'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ message: message('forwarded-1', TARGET_CHAT, 'переслано') });
      })
    );

    await createService().forwardMessage('source-message', TARGET_CHAT);

    expect(body).toEqual({ targetChatId: TARGET_CHAT });
  });
});

describe('сторож открытого текста', () => {
  it('should catch a plaintext body reaching the network', async () => {
    // Проверка самого сторожа: он обязан замечать секрет в теле запроса.
    // Если этот тест начнёт проходить молча, защита перестала работать.
    const secret = secretText('пароль');

    server.use(http.post(api('/probe'), () => HttpResponse.json({ ok: true })));
    await createApiClient().post('/probe', { note: secret });

    const { assertNoPlaintextLeaked } = await import('@/test/msw/plaintextGuard');
    expect(() => assertNoPlaintextLeaked()).toThrow(/Открытый текст ушёл на сервер/);
  });
});

describe('MessageService: отметка о прочтении', () => {
  it('should confirm ids even when the chat was never loaded', async () => {
    // При первом открытии чата внутренний кеш пуст. Раньше список
    // подтверждённых строился из него — и отметка не доходила до интерфейса.
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
