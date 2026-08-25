import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '@/api/apiFactory';
import { makeChat, makePin } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { CryptoService } from './CryptoService';
import { MessageService } from './MessageService';

// У закреплённого сообщения два идентификатора: id самого закрепления
// и messageId — идентификатор сообщения. Фикстура даёт им разные значения,
// поэтому путаница между ними видна в тестах.

const passthroughCrypto = {
  decryptDM: async (content: string) => content,
  decryptGroup: async (_chatId: string, content: string) => content,
} as unknown as CryptoService;

const chat = makeChat();

function createService() {
  return new MessageService(createApiClient(), passthroughCrypto);
}

/** Наполняет кеш закреплённых через обычный путь: запрос списка. */
async function withPinnedInCache(service: MessageService, pins: ReturnType<typeof makePin>[]) {
  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins }))
  );

  return service.listPins(chat.id);
}

describe('кеш закреплённых сообщений', () => {
  let service: MessageService;

  beforeEach(() => {
    service = createService();
    server.use(
      http.delete(api('/chats/:chatId/pins/:messageId'), () => HttpResponse.json({ success: true }))
    );
  });

  it('should drop the message from cache after unpinning', async () => {
    const pin = makePin({ chatId: chat.id });
    await withPinnedInCache(service, [pin]);

    await service.unpinMessage(chat.id, pin.messageId);

    // Кеш живёт до конца сессии, поэтому повторный запрос отдаёт его же:
    // если запись осталась, сообщение вернётся в закреплённые.
    const stillPinned = await service.listPins(chat.id);
    expect(stillPinned).toHaveLength(0);
  });

  it('should keep other pinned messages untouched', async () => {
    const kept = makePin({ chatId: chat.id });
    const removed = makePin({ chatId: chat.id });
    await withPinnedInCache(service, [kept, removed]);

    await service.unpinMessage(chat.id, removed.messageId);

    const remaining = await service.listPins(chat.id);
    expect(remaining.map((item) => item.messageId)).toEqual([kept.messageId]);
  });

  it('should not confuse the pin id with the message id', async () => {
    const pin = makePin({ chatId: chat.id });
    await withPinnedInCache(service, [pin]);

    // Открепление по идентификатору самого закрепления — не то же самое,
    // что по идентификатору сообщения: запись остаться не должна лишь тогда,
    // когда передан messageId.
    await service.unpinMessage(chat.id, pin.id);

    const remaining = await service.listPins(chat.id);
    expect(remaining).toHaveLength(1);
  });
});
