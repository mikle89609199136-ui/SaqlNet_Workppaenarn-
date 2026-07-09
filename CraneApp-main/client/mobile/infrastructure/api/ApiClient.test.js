import { describe, expect, it } from 'vitest';
import ApiClient from './ApiClient.js';

describe('ApiClient', () => {
  it('does not duplicate the /api/v2 base path for absolute v2 endpoints', () => {
    const client = new ApiClient('http://localhost:8080/api/v2');

    expect(client.buildUrl('/api/v2/chats/chat-1')).toBe('http://localhost:8080/api/v2/chats/chat-1');
  });

  it('builds relative v2 URLs with query parameters', () => {
    const client = new ApiClient('http://localhost:8080/api/v2');

    expect(client.buildUrl('/messages/chat-1', { limit: 50, offset: 0 })).toBe('http://localhost:8080/api/v2/messages/chat-1?limit=50&offset=0');
  });
});
