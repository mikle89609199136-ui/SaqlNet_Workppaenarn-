import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveCallSession } from './ActiveCallSession';
import { useCallStore } from '../model/callStore';
import type { IActiveCall } from '../model/types';

class FakeTrack {
  kind: 'audio' | 'video';
  enabled = true;
  readyState = 'live';
  constructor(kind: 'audio' | 'video') {
    this.kind = kind;
  }
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

class FakeStream {
  private tracks: FakeTrack[] = [];
  constructor(tracks: FakeTrack[] = [new FakeTrack('audio')]) {
    this.tracks = tracks;
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

if (typeof globalThis.MediaStream === 'undefined') {
  globalThis.MediaStream = FakeStream as unknown as typeof MediaStream;
}

if (!('srcObject' in HTMLMediaElement.prototype)) {
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    get() {
      return (this as any)._srcObject ?? null;
    },
    set(stream) {
      (this as any)._srcObject = stream;
    },
    configurable: true,
  });
}

const mockStartMedia = vi.fn();
const mockStopMedia = vi.fn();
const mockToggleAudio = vi.fn();
const mockToggleVideo = vi.fn();
const mockSwitchCamera = vi.fn();
const mockOnTrackReplaced = vi.fn(() => () => {});
const mockReplaceTrack = vi.fn();

const mockLocalMedia = {
  stream: new FakeStream() as unknown as MediaStream,
  isAudioMuted: false,
  isVideoMuted: false,
  facingMode: 'user' as const,
  videoInputs: [{ deviceId: 'cam-1', label: 'Cam 1', kind: 'videoinput' as const }],
  audioInputs: [{ deviceId: 'mic-1', label: 'Mic 1', kind: 'audioinput' as const }],
  selectedAudioDeviceId: null,
  selectedVideoDeviceId: null,
  error: null,
  isLoading: false,
  audioTrack: null,
  videoTrack: null,
  startMedia: mockStartMedia,
  stopMedia: mockStopMedia,
  toggleAudio: mockToggleAudio,
  toggleVideo: mockToggleVideo,
  switchCamera: mockSwitchCamera,
  switchMicrophone: vi.fn(),
  enumerateDevices: vi.fn(),
  manager: {
    onTrackReplaced: mockOnTrackReplaced,
  } as any,
};

import { eventBus } from '@/shared/lib/event-bus';
import { WS_EVENTS } from '@/shared/config';

const mockRestartIce = vi.fn(async () => {});
const mockResetConnection = vi.fn();

const makePeerConn = (connState: RTCPeerConnectionState, stream: MediaStream | null = null) => ({
  connectionState: connState,
  remoteStream: stream,
  manager: null,
  replaceTrack: mockReplaceTrack,
  restartIce: mockRestartIce,
  resetConnection: mockResetConnection,
  close: vi.fn(),
});

describe('ActiveCallSession', () => {
  const calleeActiveCall: IActiveCall = {
    roomId: 'room-callee-1',
    type: 'p2p',
    kind: 'audio',
    peerId: 'peer-alice',
    peerName: 'Алиса',
    isCaller: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useCallStore.setState({
      fsm: {
        state: 'connecting',
        roomId: 'room-callee-1',
        peerId: 'peer-alice',
        peerName: 'Алиса',
        callKind: 'audio',
        roomType: 'p2p',
        isCaller: false,
        outgoingPhase: null,
        endReason: null,
        callStartedAt: null,
        title: null,
        chatId: null,
        peerAvatar: null,
      },
    });
  });

  it('принявший звонок (callee) переходит в active по событию WebRTC connected (#774 / #813)', () => {
    const { rerender } = render(
      <ActiveCallSession
        activeCall={calleeActiveCall}
        isMinimized={false}
        localMedia={mockLocalMedia}
        peerConnection={makePeerConn('connecting')}
      />
    );

    expect(useCallStore.getState().fsm.state).toBe('connecting');
    expect(useCallStore.getState().fsm.callStartedAt).toBeNull();

    // Симулируем переход WebRTC соединения в connected
    act(() => {
      rerender(
        <ActiveCallSession
          activeCall={calleeActiveCall}
          isMinimized={false}
          localMedia={mockLocalMedia}
          peerConnection={makePeerConn('connected')}
        />
      );
    });

    expect(useCallStore.getState().fsm.state).toBe('active');
    expect(useCallStore.getState().fsm.callStartedAt).toBeGreaterThan(0);
  });

  it('монтирует скрытый audio-элемент и привязывает remoteStream для воспроизведения звука', () => {
    const fakeRemoteStream = new FakeStream() as unknown as MediaStream;

    const { container } = render(
      <ActiveCallSession
        activeCall={calleeActiveCall}
        isMinimized={false}
        localMedia={mockLocalMedia}
        peerConnection={makePeerConn('connected', fakeRemoteStream)}
      />
    );

    const audioElement = container.querySelector('audio');
    expect(audioElement).toBeInTheDocument();
    expect(audioElement?.srcObject).toBe(fakeRemoteStream);
  });

  it('переводит звонок в reconnecting при обрыве соединения disconnected / failed', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
        callStartedAt: Date.now() - 5000,
      },
    });

    const { rerender } = render(
      <ActiveCallSession
        activeCall={calleeActiveCall}
        isMinimized={false}
        localMedia={mockLocalMedia}
        peerConnection={makePeerConn('disconnected')}
      />
    );

    expect(useCallStore.getState().fsm.state).toBe('reconnecting');
    expect(mockRestartIce).toHaveBeenCalledTimes(1);

    // Восстановление соединения
    act(() => {
      rerender(
        <ActiveCallSession
          activeCall={calleeActiveCall}
          isMinimized={false}
          localMedia={mockLocalMedia}
          peerConnection={makePeerConn('connected')}
        />
      );
    });

    expect(useCallStore.getState().fsm.state).toBe('active');
  });

  it('рендерит свёрнутую плашку MinimizedCallBar при isMinimized === true', () => {
    render(
      <ActiveCallSession
        activeCall={calleeActiveCall}
        isMinimized={true}
        localMedia={mockLocalMedia}
        peerConnection={makePeerConn('connected')}
      />
    );

    expect(screen.getByRole('region', { name: 'Свёрнутый звонок' })).toBeInTheDocument();
  });

  it('вызывает resetConnection при call_peer_joined, если звонок в состоянии reconnecting', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'reconnecting',
      },
    });

    render(
      <ActiveCallSession
        activeCall={calleeActiveCall}
        isMinimized={false}
        localMedia={mockLocalMedia}
        peerConnection={makePeerConn('new')}
      />
    );

    act(() => {
      eventBus.emit(WS_EVENTS.CALL.PEER_JOINED, {
        roomId: calleeActiveCall.roomId,
        peer: { userId: 'alice' },
      });
    });

    expect(mockResetConnection).toHaveBeenCalledTimes(1);
  });

  it('вызывает resetConnection и переводит в reconnecting при call_peer_joined, если звонок ранее был connected', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
      },
    });

    render(
      <ActiveCallSession
        activeCall={calleeActiveCall}
        isMinimized={false}
        localMedia={mockLocalMedia}
        peerConnection={makePeerConn('connected')}
      />
    );

    act(() => {
      eventBus.emit(WS_EVENTS.CALL.PEER_JOINED, {
        roomId: calleeActiveCall.roomId,
        peer: { userId: 'alice' },
      });
    });

    expect(mockResetConnection).toHaveBeenCalledTimes(1);
    expect(useCallStore.getState().fsm.state).toBe('reconnecting');
  });

  it('вызывает resetConnection при call_joined, если соединение уже было установлено', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'active',
      },
    });

    render(
      <ActiveCallSession
        activeCall={calleeActiveCall}
        isMinimized={false}
        localMedia={mockLocalMedia}
        peerConnection={makePeerConn('connected')}
      />
    );

    act(() => {
      eventBus.emit(WS_EVENTS.CALL.JOINED, {
        roomId: calleeActiveCall.roomId,
        peers: [],
        self: { userId: 'callee' },
      });
    });

    expect(mockResetConnection).toHaveBeenCalledTimes(1);
  });

  it('не вызывает resetConnection при call_peer_joined во время первичного установления соединения', () => {
    useCallStore.setState({
      fsm: {
        ...useCallStore.getState().fsm,
        state: 'connecting',
      },
    });

    render(
      <ActiveCallSession
        activeCall={calleeActiveCall}
        isMinimized={false}
        localMedia={mockLocalMedia}
        peerConnection={makePeerConn('connecting')}
      />
    );

    act(() => {
      eventBus.emit(WS_EVENTS.CALL.PEER_JOINED, {
        roomId: calleeActiveCall.roomId,
        peer: { userId: 'alice' },
      });
    });

    expect(mockResetConnection).not.toHaveBeenCalled();
  });
});
