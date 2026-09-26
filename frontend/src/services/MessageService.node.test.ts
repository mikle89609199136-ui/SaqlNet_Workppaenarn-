import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { MAX_MESSAGES_PER_SEND } from '@/shared/config';
import { createApiClient } from '@/shared/api';
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
  decryptMessage: async (_chatId: string, content: string) => ({ text: content }),
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

/**
 * Сервер отправки (#808): принимает пачку и отвечает сообщениями в том же
 * порядке. Запоминает, что и сколькими запросами у него просили.
 */
function serveSend() {
  const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
  server.use(
    http.post(api(`/messages/${TARGET_CHAT}`), async ({ request }) => {
      const body = (await request.json()) as { messages: Array<Record<string, unknown>> };
      requests.push(body);
      return HttpResponse.json({
        messages: body.messages.map((item, index) =>
          message(`sent-${index}`, TARGET_CHAT, String(item.content ?? ''))
        ),
      });
    })
  );
  return requests;
}

describe('MessageService: отправка пачкой (#808)', () => {
  it('одно сообщение уходит пачкой из одного и возвращается расшифрованным', async () => {
    const requests = serveSend();

    const sent = await createService().sendMessage(TARGET_CHAT, '  обычное  ');

    expect(requests).toHaveLength(1);
    expect(requests[0].messages).toHaveLength(1);
    expect(requests[0].messages[0]).toMatchObject({ content: 'обычное', type: 'text' });
    expect(requests[0].messages[0]).not.toHaveProperty('forwardedFrom');
    expect(sent).toMatchObject({ id: 'sent-0', content: 'обычное' });
  });
});

describe('MessageService: пересылка', () => {
  it('should send the message into the target chat as a new one', async () => {
    // Серверная пересылка копировала шифртекст исходного чата, а ключи у
    // чатов разные — в целевом такое сообщение не расшифровалось бы
    // никогда. Поэтому текст шифруется заново, ключом целевого чата.
    const requests = serveSend();

    await createService().forwardMessages(TARGET_CHAT, [
      message('source', 'chat-source', 'переслано'),
    ]);

    expect(requests[0].messages[0]).toMatchObject({ content: 'переслано', type: 'text' });
  });

  it('should tell the server which message is forwarded', async () => {
    // Имя автора сервер подставит сам, проверив доступ: от клиента имя не
    // принимается, передаётся только идентификатор (#358).
    const requests = serveSend();

    await createService().forwardMessages(TARGET_CHAT, [
      message('source', 'chat-source', 'переслано'),
    ]);

    expect(requests[0].messages[0]).toMatchObject({ forwardedFrom: 'source' });
    expect(requests[0].messages[0]).not.toHaveProperty('forwardedSenderName');
  });

  it('комментарий и пересланные уходят одним запросом, комментарий первым', async () => {
    const requests = serveSend();

    const delivered = await createService().forwardMessages(
      TARGET_CHAT,
      [message('first', 'chat-source', 'первое'), message('second', 'chat-source', 'второе')],
      'смотри'
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].messages.map((item) => [item.content, item.forwardedFrom])).toEqual([
      ['смотри', undefined],
      ['первое', 'first'],
      ['второе', 'second'],
    ]);
    expect(delivered.map((item) => item.content)).toEqual(['смотри', 'первое', 'второе']);
  });

  it('больше предела за раз не отправляет', async () => {
    const requests = serveSend();
    const tooMany = Array.from({ length: MAX_MESSAGES_PER_SEND }, (_, index) =>
      message(`m-${index}`, 'chat-source', `сообщение ${index}`)
    );

    // С комментарием выходит на одно больше предела.
    await expect(
      createService().forwardMessages(TARGET_CHAT, tooMany, 'комментарий')
    ).rejects.toThrow(/Не больше/);
    expect(requests).toHaveLength(0);
  });

  it('отказывается пересылать то, что не смог прочитать', async () => {
    /* Пересылка идёт из ленты: если сообщение не расшифровалось, пересылать
       нечего — уйдёт сама заглушка, и получатель увидит замок как текст.

       Признак, а не текст: подпись заглушки переводится, и проверка по
       ведущему замку сломалась бы вместе с переводом. */
    const requests = serveSend();
    const unreadable = {
      ...message('source', 'chat-source', '🔒 Ключ шифрования недоступен'),
      undecryptable: 'keyUnavailable' as const,
    };

    await expect(
      createService().forwardMessages(TARGET_CHAT, [
        message('readable', 'chat-source', 'читается'),
        unreadable,
      ])
    ).rejects.toThrow(/не удалось расшифровать/);
    // Пачка — всё или ничего: не уходит и читаемое.
    expect(requests).toHaveLength(0);
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
