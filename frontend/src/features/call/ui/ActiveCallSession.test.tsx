import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveCallSession } from './ActiveCallSession';
import type { ICallAudioEnvironment } from '../model/callAudioPipeline';
import { useCallStore } from '../model/callStore';
import type { TTrackReplacedCallback } from '../model/localMedia';
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

  describe('ответ на видеозвонок без видео (#954)', () => {
    const videoCall: IActiveCall = { ...calleeActiveCall, kind: 'video' };

    afterEach(() => {
      useCallStore.setState({ startsWithoutVideo: false });
    });

    it('камера выключается один раз, как только появился поток', () => {
      useCallStore.setState({ startsWithoutVideo: true });

      const { rerender } = render(
        <ActiveCallSession
          activeCall={videoCall}
          isMinimized={false}
          localMedia={mockLocalMedia}
          peerConnection={makePeerConn('connected')}
        />
      );
      rerender(
        <ActiveCallSession
          activeCall={videoCall}
          isMinimized={false}
          localMedia={{ ...mockLocalMedia }}
          peerConnection={makePeerConn('connected')}
        />
      );

      expect(mockToggleVideo).toHaveBeenCalledTimes(1);
      expect(mockToggleVideo).toHaveBeenCalledWith(false);
    });

    it('обычный ответ камеру не трогает', () => {
      render(
        <ActiveCallSession
          activeCall={videoCall}
          isMinimized={false}
          localMedia={mockLocalMedia}
          peerConnection={makePeerConn('connected')}
        />
      );

      expect(mockToggleVideo).not.toHaveBeenCalled();
    });
  });
});

describe('ActiveCallSession: обработка микрофона (#947)', () => {
  class SendTrack {
    enabled = true;
    applyConstraints = vi.fn(async () => undefined);
    readonly kind: 'audio' | 'video';
    readonly label: string;
    constructor(kind: 'audio' | 'video', label: string) {
      this.kind = kind;
      this.label = label;
    }
    stop() {}
  }

  /** Поток с подменой треков на месте — как настоящий `MediaStream`. */
  class SendStream {
    private tracks: SendTrack[];
    constructor(tracks: SendTrack[] = []) {
      this.tracks = [...tracks];
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
    addTrack(track: SendTrack) {
      this.tracks.push(track);
    }
    removeTrack(track: SendTrack) {
      this.tracks = this.tracks.filter((t) => t !== track);
    }
  }

  const processed = new SendTrack('audio', 'processed');
  const node = () => ({ connect: (to: unknown) => to, disconnect: vi.fn(), destroy: vi.fn() });
  const param = () => ({ value: 0, setTargetAtTime: vi.fn() });
  const context = {
    state: 'suspended',
    currentTime: 0,
    createGain: () => ({ ...node(), gain: param() }),
    createDynamicsCompressor: () => ({
      ...node(),
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
    }),
    createAnalyser: () => ({ ...node(), fftSize: 0, getFloatTimeDomainData: vi.fn() }),
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    close: vi.fn(async () => undefined),
    createMediaStreamDestination: () => ({
      ...node(),
      stream: { getAudioTracks: () => [processed] },
    }),
  };
  const createSource = vi.fn(() => node());
  // Один объект на все тесты: окружение — зависимость эффекта обработки.
  const audioEnvironment = {
    isSupported: () => true,
    canDenoise: () => true,
    every: () => () => undefined,
    createAudioContext: () => context,
    createDenoiser: async () => node(),
    createSource,
    onUserGesture: () => () => undefined,
  } as unknown as ICallAudioEnvironment;

  const audioCall: IActiveCall = {
    roomId: 'room-947',
    type: 'p2p',
    kind: 'video',
    peerId: 'peer-alice',
    peerName: 'Алиса',
    isCaller: true,
  };

  let originalMediaStream: typeof MediaStream;
  let handlers: TTrackReplacedCallback[];

  const makeLocalMedia = (stream: SendStream | null, isAudioMuted = false) => ({
    ...mockLocalMedia,
    stream: stream as unknown as MediaStream,
    isAudioMuted,
    manager: {
      onTrackReplaced: (cb: TTrackReplacedCallback) => {
        handlers.push(cb);
        return () => {
          handlers = handlers.filter((h) => h !== cb);
        };
      },
    } as any,
  });

  const replaceTrackCalls = (kind: 'audio' | 'video') =>
    mockReplaceTrack.mock.calls
      .filter(([k]) => k === kind)
      .map(([, track]) => (track as unknown as SendTrack).label);

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = [];
    context.state = 'suspended';
    originalMediaStream = globalThis.MediaStream;
    globalThis.MediaStream = SendStream as unknown as typeof MediaStream;
  });

  afterEach(() => {
    globalThis.MediaStream = originalMediaStream;
  });

  it('микрофон просится без браузерного шумодава, если будет свой', () => {
    render(
      <ActiveCallSession
        activeCall={audioCall}
        isMinimized={false}
        localMedia={makeLocalMedia(null)}
        peerConnection={makePeerConn('connecting')}
        audioEnvironment={audioEnvironment}
      />
    );

    expect(mockStartMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      },
      video: true,
      videoOptional: false,
    });
  });

  it('в соединение уходит обработанный звук', async () => {
    const mic = new SendTrack('audio', 'mic');
    render(
      <ActiveCallSession
        activeCall={audioCall}
        isMinimized={false}
        localMedia={makeLocalMedia(new SendStream([mic, new SendTrack('video', 'cam')]))}
        peerConnection={makePeerConn('connected')}
        audioEnvironment={audioEnvironment}
      />
    );

    await waitFor(() => expect(replaceTrackCalls('audio')).toEqual(['processed']));
    expect(mic.applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: false });
  });

  it('смена камеры — в соединение уходит новая камера, а не прежняя', async () => {
    const cam = new SendTrack('video', 'cam');
    render(
      <ActiveCallSession
        activeCall={audioCall}
        isMinimized={false}
        localMedia={makeLocalMedia(new SendStream([new SendTrack('audio', 'mic'), cam]))}
        peerConnection={makePeerConn('connected')}
        audioEnvironment={audioEnvironment}
      />
    );
    await waitFor(() => expect(replaceTrackCalls('audio')).toEqual(['processed']));

    const nextCam = new SendTrack('video', 'next-cam');
    act(() => {
      handlers.forEach((h) =>
        h('video', cam as unknown as MediaStreamTrack, nextCam as unknown as MediaStreamTrack)
      );
    });

    expect(replaceTrackCalls('video')).toEqual(['next-cam']);
  });

  it('смена микрофона перецепляет обработку и не трогает отправку звука', async () => {
    const mic = new SendTrack('audio', 'mic');
    render(
      <ActiveCallSession
        activeCall={audioCall}
        isMinimized={false}
        localMedia={makeLocalMedia(new SendStream([mic]))}
        peerConnection={makePeerConn('connected')}
        audioEnvironment={audioEnvironment}
      />
    );
    await waitFor(() => expect(replaceTrackCalls('audio')).toEqual(['processed']));

    const nextMic = new SendTrack('audio', 'next-mic');
    act(() => {
      handlers.forEach((h) =>
        h('audio', mic as unknown as MediaStreamTrack, nextMic as unknown as MediaStreamTrack)
      );
    });

    expect(createSource).toHaveBeenLastCalledWith(context, nextMic);
    expect(replaceTrackCalls('audio')).toEqual(['processed']);
  });

  it('выключение микрофона гасит отправляемый трек', async () => {
    const stream = new SendStream([new SendTrack('audio', 'mic')]);
    const { rerender } = render(
      <ActiveCallSession
        activeCall={audioCall}
        isMinimized={false}
        localMedia={makeLocalMedia(stream)}
        peerConnection={makePeerConn('connected')}
        audioEnvironment={audioEnvironment}
      />
    );
    await waitFor(() => expect(replaceTrackCalls('audio')).toEqual(['processed']));

    rerender(
      <ActiveCallSession
        activeCall={audioCall}
        isMinimized={false}
        localMedia={makeLocalMedia(stream, true)}
        peerConnection={makePeerConn('connected')}
        audioEnvironment={audioEnvironment}
      />
    );

    expect(processed.enabled).toBe(false);
  });
});
