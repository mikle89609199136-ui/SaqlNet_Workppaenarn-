import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  addOutboxItem,
  clearOutbox,
  getChatOutbox,
  getOutboxItem,
  getRetryableOutboxItems,
  removeOutboxItem,
  updateOutboxItem,
  useOutboxStore,
} from './outboxStore';

describe('useOutboxStore', () => {
  beforeEach(() => {
    clearOutbox();
    vi.restoreAllMocks();
  });

  it('should add and retrieve outbox items', () => {
    addOutboxItem({
      tempId: 'temp-1',
      chatId: 'chat-1',
      content: 'hello',
      type: 'text',
      status: 'pending',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });

    const item = getOutboxItem('temp-1');
    expect(item).toBeDefined();
    expect(item?.content).toBe('hello');
    expect(item?.status).toBe('pending');
  });

  it('should update an existing outbox item', () => {
    addOutboxItem({
      tempId: 'temp-1',
      chatId: 'chat-1',
      content: 'hello',
      type: 'text',
      status: 'pending',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });

    updateOutboxItem('temp-1', { status: 'failed', error: 'Network error' });
    const item = getOutboxItem('temp-1');
    expect(item?.status).toBe('failed');
    expect(item?.error).toBe('Network error');
  });

  it('should remove item and revoke blobUrl if present', () => {
    const revokeMock = vi.fn();
    globalThis.URL.revokeObjectURL = revokeMock;

    addOutboxItem({
      tempId: 'temp-media',
      chatId: 'chat-1',
      content: '',
      type: 'image',
      status: 'uploading',
      blobUrl: 'blob:http://localhost/abc-123',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });

    removeOutboxItem('temp-media');
    expect(getOutboxItem('temp-media')).toBeUndefined();
    expect(revokeMock).toHaveBeenCalledWith('blob:http://localhost/abc-123');
  });

  it('should store and update retryCount and lastAttemptAt', () => {
    addOutboxItem({
      tempId: 'temp-retry',
      chatId: 'chat-1',
      content: 'msg',
      type: 'text',
      status: 'pending',
      createdAt: new Date(),
    });

    const now = Date.now();
    updateOutboxItem('temp-retry', {
      status: 'failed',
      retryCount: 1,
      lastAttemptAt: now,
    });

    const item = getOutboxItem('temp-retry');
    expect(item?.retryCount).toBe(1);
    expect(item?.lastAttemptAt).toBe(now);
  });

  it('should filter items by chat and retryable status', () => {
    addOutboxItem({
      tempId: 'temp-1',
      chatId: 'chat-1',
      content: 'msg 1',
      type: 'text',
      status: 'failed',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });
    addOutboxItem({
      tempId: 'temp-2',
      chatId: 'chat-1',
      content: 'msg 2',
      type: 'text',
      status: 'sent',
      createdAt: new Date('2026-09-07T00:00:01Z'),
    });
    addOutboxItem({
      tempId: 'temp-3',
      chatId: 'chat-2',
      content: 'msg 3',
      type: 'text',
      status: 'pending',
      createdAt: new Date('2026-09-07T00:00:02Z'),
    });

    expect(getChatOutbox('chat-1')).toHaveLength(2);
    expect(getChatOutbox('chat-2')).toHaveLength(1);

    const retryableChat1 = getRetryableOutboxItems('chat-1');
    expect(retryableChat1).toHaveLength(1);
    expect(retryableChat1[0]?.tempId).toBe('temp-1');

    const allRetryable = getRetryableOutboxItems();
    expect(allRetryable).toHaveLength(2);
  });

  it('should clear all items and revoke all blob URLs on clearAll', () => {
    const revokeMock = vi.fn();
    globalThis.URL.revokeObjectURL = revokeMock;

    addOutboxItem({
      tempId: 'temp-media-1',
      chatId: 'chat-1',
      content: '',
      type: 'image',
      status: 'uploading',
      blobUrl: 'blob:http://localhost/1',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });
    addOutboxItem({
      tempId: 'temp-media-2',
      chatId: 'chat-1',
      content: '',
      type: 'image',
      status: 'uploading',
      blobUrl: 'blob:http://localhost/2',
      createdAt: new Date('2026-09-07T00:00:00Z'),
    });

    clearOutbox();
    expect(useOutboxStore.getState().items).toHaveLength(0);
    expect(revokeMock).toHaveBeenCalledTimes(2);
  });
});
