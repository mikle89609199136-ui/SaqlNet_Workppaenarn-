import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { services } from '@/services';
import {
  addOutboxItem,
  clearOutbox,
  getOutboxItem,
} from '@/store/outbox';
import {
  resetInFlightForTests,
  retryAllOutboxMessages,
  retryOutboxMessage,
  sendOutboxItem,
} from './outboxSender';
import { chatKeys } from '../keys';
import { makeMessage } from '@/test/fixtures';

describe('outboxSender', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clearOutbox();
    resetInFlightForTests();
    vi.restoreAllMocks();
  });

  it('should successfully send text message, replace cache and clear outbox', async () => {
    const tempId = 'temp-text-1';
    const chatId = 'chat-1';
    const serverMessage = makeMessage({ id: 'server-100', chatId, content: 'Привет' });

    vi.spyOn(services.messageService, 'sendMessage').mockResolvedValue(serverMessage);

    // Подготавливаем кеш треда
    const initialPages = {
      pages: [[makeMessage({ id: tempId, chatId, content: 'Привет', status: 'pending' })]],
      pageParams: [0],
    };
    queryClient.setQueryData(chatKeys.messages(chatId), initialPages);

    addOutboxItem({
      tempId,
      chatId,
      content: 'Привет',
      type: 'text',
      status: 'pending',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });

    const item = getOutboxItem(tempId)!;
    await sendOutboxItem(queryClient, item);

    expect(services.messageService.sendMessage).toHaveBeenCalledWith(
      chatId,
      'Привет',
      'text',
      null
    );

    // Проверяем, что элемент удалён из outbox
    expect(getOutboxItem(tempId)).toBeUndefined();

    // Проверяем, что в кеше сообщение заменено на серверное
    const cached: any = queryClient.getQueryData(chatKeys.messages(chatId));
    expect(cached.pages[0][0].id).toBe('server-100');
  });

  it('should mark message as failed in cache and outbox on error', async () => {
    const tempId = 'temp-err-1';
    const chatId = 'chat-1';

    vi.spyOn(services.messageService, 'sendMessage').mockRejectedValue(new Error('Network error'));

    const initialPages = {
      pages: [[makeMessage({ id: tempId, chatId, content: 'Упадёт', status: 'pending' })]],
      pageParams: [0],
    };
    queryClient.setQueryData(chatKeys.messages(chatId), initialPages);

    addOutboxItem({
      tempId,
      chatId,
      content: 'Упадёт',
      type: 'text',
      status: 'pending',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });

    const item = getOutboxItem(tempId)!;
    await sendOutboxItem(queryClient, item);

    // Элемент остался в outbox со статусом failed
    const saved = getOutboxItem(tempId);
    expect(saved).toBeDefined();
    expect(saved?.status).toBe('failed');
    expect(saved?.error).toBe('Network error');

    // В кеше треда статус тоже failed
    const cached: any = queryClient.getQueryData(chatKeys.messages(chatId));
    expect(cached.pages[0][0].status).toBe('failed');
  });

  it('should retry a failed message via retryOutboxMessage', async () => {
    const tempId = 'temp-retry-1';
    const chatId = 'chat-1';
    const serverMessage = makeMessage({ id: 'server-200', chatId, content: 'Повтор' });

    vi.spyOn(services.messageService, 'sendMessage').mockResolvedValue(serverMessage);

    const initialPages = {
      pages: [[makeMessage({ id: tempId, chatId, content: 'Повтор', status: 'failed' })]],
      pageParams: [0],
    };
    queryClient.setQueryData(chatKeys.messages(chatId), initialPages);

    addOutboxItem({
      tempId,
      chatId,
      content: 'Повтор',
      type: 'text',
      status: 'failed',
      error: 'Previous failure',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });

    await retryOutboxMessage(queryClient, tempId);

    expect(services.messageService.sendMessage).toHaveBeenCalledWith(
      chatId,
      'Повтор',
      'text',
      null
    );
    expect(getOutboxItem(tempId)).toBeUndefined();
  });

  it('should send media message and update progress', async () => {
    const tempId = 'temp-media-1';
    const chatId = 'chat-1';
    const file = new File(['content'], 'test.png', { type: 'image/png' });
    const serverMessage = makeMessage({ id: 'server-media-1', chatId, mediaUrl: '/media/1' });

    vi.spyOn(services.messageService, 'sendMediaMessage').mockResolvedValue(serverMessage as any);

    const initialPages = {
      pages: [[makeMessage({ id: tempId, chatId, status: 'uploading' })]],
      pageParams: [0],
    };
    queryClient.setQueryData(chatKeys.messages(chatId), initialPages);

    addOutboxItem({
      tempId,
      chatId,
      content: 'Картинка',
      type: 'image',
      file,
      status: 'uploading',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });

    const item = getOutboxItem(tempId)!;
    await sendOutboxItem(queryClient, item);

    expect(services.messageService.sendMediaMessage).toHaveBeenCalledWith(
      chatId,
      file,
      'image',
      'Картинка',
      null
    );
    expect(getOutboxItem(tempId)).toBeUndefined();
  });

  it('should retry all failed or pending messages for a chat', async () => {
    const chatId = 'chat-batch';
    const serverMessage = makeMessage({ id: 'server-b' });
    vi.spyOn(services.messageService, 'sendMessage').mockResolvedValue(serverMessage);

    addOutboxItem({
      tempId: 'temp-b1',
      chatId,
      content: 'msg1',
      type: 'text',
      status: 'failed',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });
    addOutboxItem({
      tempId: 'temp-b2',
      chatId,
      content: 'msg2',
      type: 'text',
      status: 'pending',
      createdAt: new Date('2026-09-07T00:00:01Z'),
    });

    await retryAllOutboxMessages(queryClient, chatId);

    expect(services.messageService.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('should skip sending and deduplicate if message already arrived via server/ws', async () => {
    const tempId = 'temp-dup-1';
    const chatId = 'chat-dup';
    const createdAt = new Date();

    // В кеше уже есть подтверждённое серверное сообщение с таким же текстом
    const initialPages = {
      pages: [[
        makeMessage({
          id: 'server-confirmed-dup',
          chatId,
          content: 'Дубликат',
          createdAt,
        }),
        makeMessage({
          id: tempId,
          chatId,
          content: 'Дубликат',
          status: 'failed',
          createdAt,
        }),
      ]],
      pageParams: [0],
    };
    queryClient.setQueryData(chatKeys.messages(chatId), initialPages);

    addOutboxItem({
      tempId,
      chatId,
      content: 'Дубликат',
      type: 'text',
      status: 'failed',
      createdAt,
    });

    const sendSpy = vi.spyOn(services.messageService, 'sendMessage');

    const item = getOutboxItem(tempId)!;
    await sendOutboxItem(queryClient, item);

    // sendMessage НЕ должен вызываться
    expect(sendSpy).not.toHaveBeenCalled();
    // Элемент удалён из outbox
    expect(getOutboxItem(tempId)).toBeUndefined();
    // Временный пузырь удалён из кеша
    const cached: any = queryClient.getQueryData(chatKeys.messages(chatId));
    expect(cached.pages[0].some((m: any) => m.id === tempId)).toBe(false);
  });
});
