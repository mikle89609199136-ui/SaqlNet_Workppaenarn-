import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { services } from '@/services';
import { addOutboxItem, clearOutbox, getOutboxItem } from './outboxStore';
import {
  cancelOutboxMessage,
  MAX_AUTO_RETRIES,
  resetInFlightForTests,
  retryAllOutboxMessages,
  retryOutboxMessage,
  sendOutboxItem,
} from './outboxSender';
import { chatKeys } from '@/entities/chat';
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
    // И помечено отправленным: из этого рисуется галочка в личном чате.
    // Серверный ответ статуса не несёт — его ставит тот, кто записал ответ.
    expect(cached.pages[0][0].status).toBe('sent');
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
    const serverMessage = {
      ...makeMessage({ id: 'server-media-1', chatId }),
      mediaUrl: '/media/1',
    };

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

  it('should send duplicate text message without silently dropping it', async () => {
    const tempId = 'temp-dup-1';
    const chatId = 'chat-dup';
    const createdAt = new Date();

    const initialPages = {
      pages: [
        [
          makeMessage({
            id: 'server-confirmed-dup',
            chatId,
            content: 'ок',
            createdAt,
          }),
          makeMessage({
            id: tempId,
            chatId,
            content: 'ок',
            status: 'pending',
            createdAt,
          }),
        ],
      ],
      pageParams: [0],
    };
    queryClient.setQueryData(chatKeys.messages(chatId), initialPages);

    addOutboxItem({
      tempId,
      chatId,
      content: 'ок',
      type: 'text',
      status: 'pending',
      createdAt,
    });

    const sendSpy = vi
      .spyOn(services.messageService, 'sendMessage')
      .mockResolvedValue(makeMessage({ id: 'server-second-dup', chatId, content: 'ок' }));

    const item = getOutboxItem(tempId)!;
    await sendOutboxItem(queryClient, item);

    // sendMessage ОБЯЗАН вызываться — повтор сообщения не должен пропадать молча
    expect(sendSpy).toHaveBeenCalledWith(chatId, 'ок', 'text', null);
    expect(getOutboxItem(tempId)).toBeUndefined();
    const cached: any = queryClient.getQueryData(chatKeys.messages(chatId));
    expect(cached.pages[0].some((m: any) => m.id === 'server-second-dup')).toBe(true);
  });

  it('should increment retryCount on failure and not auto-retry beyond MAX_AUTO_RETRIES', async () => {
    const tempId = 'temp-fail-limit';
    const chatId = 'chat-limit';

    addOutboxItem({
      tempId,
      chatId,
      content: 'Сообщение с лимитом',
      type: 'text',
      status: 'pending',
      retryCount: MAX_AUTO_RETRIES,
      lastAttemptAt: Date.now(),
      createdAt: new Date(),
    });

    const sendSpy = vi.spyOn(services.messageService, 'sendMessage');

    // Авто-повтор должен пропустить элемент, превысивший лимит
    await retryAllOutboxMessages(queryClient, chatId);
    expect(sendSpy).not.toHaveBeenCalled();

    // Ручной повтор сбрасывает retryCount и отправляет
    sendSpy.mockResolvedValueOnce(makeMessage({ id: 'srv-1', chatId }));
    await retryOutboxMessage(queryClient, tempId);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(getOutboxItem(tempId)).toBeUndefined();
  });

  it('cancelOutboxMessage should remove outbox item and drop thread message', () => {
    const tempId = 'temp-cancel-1';
    const chatId = 'chat-cancel';

    queryClient.setQueryData(chatKeys.messages(chatId), {
      pages: [[makeMessage({ id: tempId, chatId, status: 'failed' })]],
      pageParams: [0],
    });

    addOutboxItem({
      tempId,
      chatId,
      content: 'Отменяемое',
      type: 'text',
      status: 'failed',
      createdAt: new Date(),
    });

    cancelOutboxMessage(queryClient, chatId, tempId);

    expect(getOutboxItem(tempId)).toBeUndefined();
    const cached: any = queryClient.getQueryData(chatKeys.messages(chatId));
    expect(cached.pages[0].some((m: any) => m.id === tempId)).toBe(false);
  });
});
