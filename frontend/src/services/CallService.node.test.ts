import { describe, expect, it, vi } from 'vitest';
import { CallService } from './CallService';
import type { ApiClient } from '@/shared/api';

describe('CallService', () => {
  const mockPost = vi.fn();
  const mockGet = vi.fn();
  const mockApiClient = {
    post: mockPost,
    get: mockGet,
  } as unknown as ApiClient;

  const service = new CallService(mockApiClient);

  it('создает комнату с передачей параметров по умолчанию', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        success: true,
        room: {
          id: 'room-123',
          type: 'p2p',
          callKind: 'video',
          chatId: 'chat-1',
          title: '',
          hostId: 'u1',
        },
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        maxParticipants: 2,
      },
    });

    const result = await service.createRoom({ chatId: 'chat-1' });

    expect(mockPost).toHaveBeenCalledWith('/calls/rooms', {
      chatId: 'chat-1',
      type: 'p2p',
      title: '',
      callKind: 'video',
    });
    expect(result.success).toBe(true);
    expect(result.room.id).toBe('room-123');
  });

  it('запрашивает существующую комнату по id', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        success: true,
        room: {
          id: 'room-456',
          type: 'p2p',
          callKind: 'audio',
          chatId: 'chat-2',
          title: 'Комната',
          hostId: 'u2',
        },
        iceServers: [],
        maxParticipants: 2,
      },
    });

    const result = await service.getRoom('room-456');

    expect(mockGet).toHaveBeenCalledWith('/calls/rooms/room-456');
    expect(result.room.id).toBe('room-456');
  });

  it('запрашивает ice-серверы', async () => {
    mockGet.mockResolvedValueOnce({
      data: { servers: [], hasTurn: false, meteredConfigured: false },
    });

    const result = await service.getIceServers();

    expect(mockGet).toHaveBeenCalledWith('/calls/ice-servers');
    expect(result.hasTurn).toBe(false);
  });

  it('запрашивает историю звонков с параметрами пагинации и фильтрации (#722)', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        calls: [
          {
            id: 'call-1',
            roomId: 'room-1',
            chatId: 'chat-1',
            peerId: 'peer-1',
            direction: 'incoming',
            kind: 'audio',
            status: 'answered',
            startedAt: '2026-10-09T12:00:00Z',
            durationSeconds: 120,
          },
        ],
        nextCursor: 'cursor-2',
        hasMore: true,
      },
    });

    const result = await service.getCallHistory({
      cursor: 'cursor-1',
      limit: 20,
      kind: 'audio',
      status: 'answered',
    });

    expect(mockGet).toHaveBeenCalledWith('/calls/history', {
      cursor: 'cursor-1',
      limit: '20',
      kind: 'audio',
      status: 'answered',
    });
    expect(result.calls).toHaveLength(1);
    expect(result.nextCursor).toBe('cursor-2');
    expect(result.hasMore).toBe(true);
  });
});
