import { describe, expect, it, vi } from 'vitest';
import MessageService from './MessageService.js';

function createApiClient() {
  return {
    delete: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  };
}

describe('MessageService', () => {
  it('loads messages from the gateway chat-specific endpoint', async () => {
    const apiClient = createApiClient();
    apiClient.get.mockImplementation(async (url) => {
      if (url.includes('/messages/')) return { data: { messages: [{ id: 'm1', chatId: 'chat-1', senderId: 'u1', type: 'text', content: 'encrypted_content' }] } };
      if (url.includes('/chats/')) return { data: { chat: { type: 'private', peerPublicKey: 'peer-key' } } };
      return {};
    });
    
    const cryptoService = { decryptDM: vi.fn().mockResolvedValue('Hello') };
    const service = new MessageService(apiClient, cryptoService);

    const messages = await service.getMessages('chat-1');

    expect(apiClient.get).toHaveBeenCalledWith('/messages/chat-1', { limit: 50, offset: 0 });
    expect(cryptoService.decryptDM).toHaveBeenCalledWith('encrypted_content', 'peer-key', {
      preferEmbeddedSenderKey: true,
    });
    expect(messages[0].content).toBe('Hello');
  });

  it('decrypts own DM messages with the peer public key after reload', async () => {
    localStorage.setItem('craneapp_user_data', JSON.stringify({ id: 'me' }));
    const apiClient = createApiClient();
    apiClient.get.mockImplementation(async (url) => {
      if (url.includes('/messages/')) {
        return { data: { messages: [{ id: 'm1', chatId: 'chat-1', senderId: 'me', type: 'text', content: 'encrypted_content' }] } };
      }
      if (url.includes('/chats/')) return { data: { chat: { type: 'private', peerPublicKey: 'peer-key' } } };
      return {};
    });

    const cryptoService = { decryptDM: vi.fn().mockResolvedValue('Hello from me') };
    const service = new MessageService(apiClient, cryptoService);

    const messages = await service.getMessages('chat-1');

    expect(cryptoService.decryptDM).toHaveBeenCalledWith('encrypted_content', 'peer-key', {
      preferEmbeddedSenderKey: false,
    });
    expect(messages[0].content).toBe('Hello from me');
  });

  it('returns loaded messages in chronological order', async () => {
    const apiClient = createApiClient();
    apiClient.get.mockImplementation(async (url) => {
      if (url.includes('/messages/')) {
        return {
          data: {
            messages: [
              { id: 'new', chatId: 'chat-1', senderId: 'u1', type: 'text', content: 'new', createdAt: '2026-06-03T12:02:00Z' },
              { id: 'old', chatId: 'chat-1', senderId: 'u1', type: 'text', content: 'old', createdAt: '2026-06-03T12:01:00Z' },
            ],
          },
        };
      }
      if (url.includes('/chats/')) return { data: { chat: { type: 'private' } } };
      return {};
    });

    const service = new MessageService(apiClient, { decryptDM: vi.fn((content) => Promise.resolve(content)) });

    const messages = await service.getMessages('chat-1');

    expect(messages.map((message) => message.id)).toEqual(['old', 'new']);
  });

  it('unwraps the send response message payload', async () => {
    const apiClient = createApiClient();
    apiClient.post.mockResolvedValue({ data: { message: { id: 'm1', chatId: 'chat-1', senderId: 'u1', content: 'encrypted_content' } } });
    apiClient.get.mockResolvedValue({ data: { chat: { type: 'private' } } });
    
    const cryptoService = { encryptDM: vi.fn().mockResolvedValue('encrypted_content') };
    const service = new MessageService(apiClient, cryptoService);

    const message = await service.sendMessage('chat-1', 'Hello');

    expect(apiClient.post).toHaveBeenCalledWith('/messages/chat-1', { content: 'encrypted_content', replyTo: null, type: 'text' });
    expect(cryptoService.encryptDM).toHaveBeenCalledWith('Hello', null);
    expect(message.id).toBe('m1');
  });

  it('updates reactions through the gateway reactions endpoint', async () => {
    const apiClient = createApiClient();
    apiClient.post.mockResolvedValue({ data: { reactions: [{ emoji: '👍', count: 1 }] } });
    const service = new MessageService(apiClient, {});

    const result = await service.reactToMessage('m1', '👍');

    expect(apiClient.post).toHaveBeenCalledWith('/messages/m1/reactions', { emoji: '👍' });
    expect(result.reactions[0].emoji).toBe('👍');
  });

  it('encrypts media before upload and stores encrypted metadata in the send payload', async () => {
    const apiClient = createApiClient();
    apiClient.get.mockResolvedValue({ data: { chat: { type: 'private', peerPublicKey: 'peer-key' } } });
    apiClient.post.mockImplementation(async (url) => {
      if (url === '/upload') {
        return { data: { url: '/api/v2/media/media-1', encryption: { version: 1, encrypted: true, algorithm: 'AES-GCM', iv: 'iv', mimeType: 'image/png', sizeBytes: 3 } } };
      }
      return { data: { message: { id: 'm1', chatId: 'chat-1', senderId: 'u1', type: 'image', mediaUrl: '/api/v2/media/media-1' } } };
    });
    const encryptedMedia = { version: 1, encrypted: true, algorithm: 'AES-GCM', iv: 'iv', ciphertext: 'cipher', mimeType: 'image/png', sizeBytes: 3 };
    const cryptoService = {
      encryptDM: vi.fn().mockResolvedValue('encrypted caption'),
      encryptMedia: vi.fn().mockResolvedValue(encryptedMedia),
      decryptMedia: vi.fn().mockResolvedValue(new Blob(['abc'], { type: 'image/png' })),
    };
    const service = new MessageService(apiClient, cryptoService);

    await service.sendMediaMessage('chat-1', 'data:image/png;base64,YWJj', 'image', 'caption');

    expect(cryptoService.encryptMedia).toHaveBeenCalledWith('chat-1', 'data:image/png;base64,YWJj', expect.objectContaining({ peerPublicKey: 'peer-key' }));
    expect(apiClient.post).toHaveBeenCalledWith('/upload', {
      file: encryptedMedia,
      type: 'image',
      purpose: 'message',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/messages/chat-1', expect.objectContaining({
      content: 'encrypted caption',
      mediaUrl: '/api/v2/media/media-1',
      mediaEncrypted: true,
      mediaEncryption: expect.objectContaining({ iv: 'iv', encrypted: true }),
    }));
  });

  it('maps legacy unencrypted message media as unavailable', async () => {
    const apiClient = createApiClient();
    apiClient.get.mockImplementation(async (url) => {
      if (url.includes('/messages/')) {
        return { data: { messages: [{ id: 'm1', chatId: 'chat-1', senderId: 'u1', type: 'image', mediaUrl: '/api/v2/media/plain-1', content: '' }] } };
      }
      if (url.includes('/chats/')) return { data: { chat: { type: 'private', peerPublicKey: 'peer-key' } } };
      return {};
    });

    const service = new MessageService(apiClient, { decryptDM: vi.fn() });
    const messages = await service.getMessages('chat-1');

    expect(messages[0].mediaUnavailable).toBe(true);
    expect(messages[0].mediaUrl).toBeNull();
    expect(messages[0].mediaUnavailableReason).toBe('Медиа недоступно: файл не зашифрован');
  });
});
