import { beforeEach, describe, expect, it, vi } from 'vitest';

// В проекте есть циклы через barrel-файлы: MessageService берёт утилиту из @/utils,
// а тот тянет clearAuthSession → @/hooks и decryptChatPreview → @/services →
// serviceContainer → MessageService. Браузерная сборка это разруливает, изоляция
// в тестах — нет, поэтому подменяем узлы цикла.
// Полная цепочка цикла: MessageService → @/core → chatCache → @/api → apiFactory →
// @/configs → router → @/services → serviceContainer → MessageService.
vi.mock('@/services', () => ({ services: {} }));
vi.mock('@/hooks', () => ({ disconnectRealtimeSocket: () => {} }));
vi.mock('@/configs', () => ({
  config: { apiBaseUrl: 'http://localhost/api/v2', socketUrl: 'ws://localhost/ws' },
}));

vi.mock('@/store', () => {
  const store = (state: Record<string, unknown>) => ({
    getState: () => state,
    setState: () => {},
    subscribe: () => () => {},
  });

  return {
    useChatStore: store({ markAsRead: () => {} }),
    useProfileStore: store({ user: null, token: null, setUser: () => {} }),
    useChatsStore: store({ chats: [], setChats: () => {} }),
    useCallStore: store({}),
    useToastStore: store({ toasts: [], addToast: () => {} }),
    useThemeStore: store({ theme: 'dark' }),
    useLanguageStore: store({ language: 'ru' }),
  };
});

import { MessageService } from './MessageService';
import type { ApiClient } from '@/api';
import type { CryptoService } from './CryptoService';
import type { IMessageDto } from '@/types';

const TARGET_CHAT = 'chat-target';
const SOURCE_CHAT = 'chat-source';

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

/**
 * Сервис ходит в сеть только через ApiClient, поэтому подменяем его целиком.
 * historyOf задаёт, что сервер отдаёт для конкретного чата.
 */
function createApiClient(historyOf: Record<string, IMessageDto[]>) {
  const get = vi.fn(async (endpoint: string) => {
    if (endpoint.startsWith('/messages/')) {
      const chatId = endpoint.replace('/messages/', '');
      return { data: { messages: historyOf[chatId] ?? [] }, status: 200, headers: new Headers() };
    }

    // getChatContext запрашивает сам чат
    return {
      data: { chat: { id: TARGET_CHAT, type: 'private', peerPublicKey: null } },
      status: 200,
      headers: new Headers(),
    };
  });

  const post = vi.fn(async () => ({
    data: { message: message('forwarded-1', TARGET_CHAT, 'переслано') },
    status: 200,
    headers: new Headers(),
  }));

  return { get, post } as unknown as ApiClient & { get: typeof get; post: typeof post };
}

// Шифрование в этих сценариях не участвует: контент возвращается как есть.
const cryptoStub = {
  decryptDM: async (content: string) => content,
  decryptGroup: async (_chatId: string, content: string) => content,
  encryptDM: async (content: string) => content,
  encryptGroup: async (_chatId: string, content: string) => content,
} as unknown as CryptoService;

describe('MessageService.getMessages', () => {
  let api: ReturnType<typeof createApiClient>;
  let service: MessageService;

  beforeEach(() => {
    api = createApiClient({
      [TARGET_CHAT]: [
        message('old-1', TARGET_CHAT, 'первое'),
        message('old-2', TARGET_CHAT, 'второе'),
      ],
    });
    service = new MessageService(api, cryptoStub);
  });

  it('запрашивает историю с сервера, когда чат ещё не открывали', async () => {
    const messages = await service.getMessages(TARGET_CHAT);

    expect(messages).toHaveLength(2);
    expect(api.get).toHaveBeenCalledWith(
      `/messages/${TARGET_CHAT}`,
      expect.objectContaining({ offset: 0 })
    );
  });

  it('отдаёт историю целевого чата после пересылки в него', async () => {
    // Пересылка в чат, который в этой сессии не открывали.
    await service.forwardMessage('source-message', TARGET_CHAT);

    const messages = await service.getMessages(TARGET_CHAT);
    const ids = messages.map((item) => item.id);

    // История чата обязана присутствовать, а не подменяться одним пересланным сообщением.
    expect(ids).toContain('old-1');
    expect(ids).toContain('old-2');
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it('не теряет историю, если чат открывали до пересылки', async () => {
    await service.getMessages(TARGET_CHAT);
    await service.forwardMessage('source-message', TARGET_CHAT);

    const messages = await service.getMessages(TARGET_CHAT);
    const ids = messages.map((item) => item.id);

    expect(ids).toContain('old-1');
    expect(ids).toContain('old-2');
    expect(ids).toContain('forwarded-1');
  });
});

describe('MessageService.forwardMessage', () => {
  it('отправляет запрос пересылки с целевым чатом', async () => {
    const api = createApiClient({ [TARGET_CHAT]: [] });
    const service = new MessageService(api, cryptoStub);

    await service.forwardMessage('source-message', TARGET_CHAT);

    expect(api.post).toHaveBeenCalledWith('/messages/source-message/forward', {
      targetChatId: TARGET_CHAT,
    });
  });
});

export { SOURCE_CHAT };
