import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePeerConnection } from './usePeerConnection';
import type { WebSocketClient } from '@/services/WebSocketClient';
import { eventBus } from '@/shared/lib/event-bus';
import { WS_EVENTS } from '@/shared/config';
import { services } from '@/services/serviceContainer';

class MockRTCPeerConnection {
  iceServers: RTCIceServer[];
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((event: unknown) => void) | null = null;
  ontrack: ((event: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  senders: { track: MediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> }[] = [];
  close(): void {}
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
  });
  setLocalDescription = vi.fn(async (desc?: RTCSessionDescriptionInit) => {
    this.localDescription = desc ?? null;
  });
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'fake-answer' }));
  addIceCandidate = vi.fn(async () => {});
  addTrack = vi.fn((track: MediaStreamTrack) => {
    const sender = { track, replaceTrack: vi.fn() };
    this.senders.push(sender);
    return sender;
  });
  getSenders = vi.fn(() => this.senders);

  constructor(config?: { iceServers?: RTCIceServer[] }) {
    this.iceServers = config?.iceServers ?? [];
  }
}

describe('usePeerConnection', () => {
  let mockSocket: WebSocketClient;

  beforeEach(() => {
    vi.spyOn(services.callService, 'getIceServers').mockResolvedValue({
      servers: [{ urls: 'stun:stun.l.google.com:19302' }],
      hasTurn: false,
      meteredConfigured: false,
    });

    mockSocket = {
      isConnected: true,
      send: vi.fn(),
    } as unknown as WebSocketClient;

    vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
    vi.stubGlobal(
      'RTCSessionDescription',
      class {
        type: string;
        sdp: string;
        constructor(init: RTCSessionDescriptionInit) {
          this.type = init.type;
          this.sdp = init.sdp ?? '';
        }
      }
    );
    vi.stubGlobal(
      'RTCIceCandidate',
      class {
        candidate: string;
        constructor(init: RTCIceCandidateInit) {
          this.candidate = init.candidate ?? '';
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('инициализирует менеджер и слушает события сигналинга из eventBus', async () => {
    const onConnectionStateChange = vi.fn();
    const closeSpy = vi.spyOn(MockRTCPeerConnection.prototype, 'close');

    const { result, unmount } = renderHook(() =>
      usePeerConnection({
        socket: mockSocket,
        roomId: 'room-100',
        peerId: 'peer-200',
        isPolite: true,
        onConnectionStateChange,
      })
    );

    expect(result.current.manager).not.toBeNull();

    // Ждём завершения промиса initialize
    await act(async () => {
      await Promise.resolve();
    });

    // Эмитируем входящий call_offer через eventBus
    eventBus.emit(WS_EVENTS.CALL.OFFER, {
      type: 'call_offer',
      roomId: 'room-100',
      from: 'peer-200',
      payload: { type: 'offer', sdp: 'remote-sdp' },
    });

    // Размонтирование закрывает соединение
    unmount();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('обрабатывает remote offer и отправляет answer через сокет', async () => {
    renderHook(() =>
      usePeerConnection({
        socket: mockSocket,
        roomId: 'room-100',
        peerId: 'peer-200',
        isPolite: true,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      eventBus.emit(WS_EVENTS.CALL.OFFER, {
        type: 'call_offer',
        roomId: 'room-100',
        from: 'peer-200',
        payload: { type: 'offer', sdp: 'remote-sdp' },
      });
      await Promise.resolve();
    });

    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call_answer',
        to: 'peer-200',
        roomId: 'room-100',
      })
    );
  });

  it('при вызове close() отписывается от сигнальных событий и не реагирует на offer', async () => {
    let hookResult: ReturnType<typeof usePeerConnection> | undefined;
    renderHook(() => {
      hookResult = usePeerConnection({
        socket: mockSocket,
        roomId: 'room-100',
        peerId: 'peer-200',
        isPolite: true,
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      hookResult?.close();
      await Promise.resolve();
    });

    mockSocket.send = vi.fn();

    await act(async () => {
      eventBus.emit(WS_EVENTS.CALL.OFFER, {
        type: 'call_offer',
        roomId: 'room-100',
        from: 'peer-200',
        payload: { type: 'offer', sdp: 'remote-sdp' },
      });
      await Promise.resolve();
    });

    expect(mockSocket.send).not.toHaveBeenCalled();
  });

  it('заменяет трек через replaceTrack', async () => {
    const { result } = renderHook(() =>
      usePeerConnection({
        socket: mockSocket,
        roomId: 'room-100',
        peerId: 'peer-200',
        isPolite: false,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    const newTrack = { kind: 'video', id: 'new-v-track' } as MediaStreamTrack;
    await act(async () => {
      await result.current.replaceTrack('video', newTrack);
    });

    expect(result.current.manager?.getPeerConnection()).not.toBeNull();
  });
});
