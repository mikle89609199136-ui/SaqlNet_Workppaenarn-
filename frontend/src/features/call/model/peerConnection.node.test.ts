import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PeerConnectionManager } from './peerConnection';
import type { WebSocketClient } from '@/services/WebSocketClient';
import { services } from '@/services/serviceContainer';

// Mock RTP Sender
class MockRTCRtpSender {
  track: MediaStreamTrack | null;
  /** Как в браузере после согласования: одна кодировка с приоритетом по умолчанию. */
  parameters: RTCRtpSendParameters = {
    encodings: [{ active: true, priority: 'low', networkPriority: 'low' }],
  } as RTCRtpSendParameters;
  replaceTrack = vi.fn(async (newTrack: MediaStreamTrack | null) => {
    this.track = newTrack;
  });
  getParameters = vi.fn(() => structuredClone(this.parameters));
  setParameters = vi.fn(async (parameters: RTCRtpSendParameters) => {
    this.parameters = parameters;
  });

  constructor(track: MediaStreamTrack | null) {
    this.track = track;
  }
}

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  iceServers: RTCIceServer[];
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  ontrack: ((event: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  senders: MockRTCRtpSender[] = [];
  addedIceCandidates: RTCIceCandidateInit[] = [];
  closed = false;

  constructor(config?: { iceServers?: RTCIceServer[] }) {
    this.iceServers = config?.iceServers ?? [];
  }

  createOffer = vi.fn(async (_options?: RTCOfferOptions) => {
    return { type: 'offer' as const, sdp: 'fake-local-offer-sdp' };
  });

  restartIce = vi.fn(() => {});

  createAnswer = vi.fn(async () => {
    return { type: 'answer' as const, sdp: 'fake-local-answer-sdp' };
  });

  setLocalDescription = vi.fn(async (desc?: RTCSessionDescriptionInit) => {
    if (desc?.type === 'rollback') {
      this.signalingState = 'stable';
      this.localDescription = null;
      return;
    }
    const resolvedDesc = desc ?? { type: 'offer' as const, sdp: 'default-offer' };
    this.localDescription = resolvedDesc;
    if (resolvedDesc.type === 'offer') {
      this.signalingState = 'have-local-offer';
    } else if (resolvedDesc.type === 'answer') {
      this.signalingState = 'stable';
    }
  });

  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-remote-offer';
    } else if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  });

  addIceCandidate = vi.fn(async (candidate: RTCIceCandidateInit) => {
    this.addedIceCandidates.push(candidate);
  });

  addTrack = vi.fn((track: MediaStreamTrack) => {
    const sender = new MockRTCRtpSender(track);
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  });

  getSenders = vi.fn(() => this.senders as unknown as RTCRtpSender[]);

  close = vi.fn(() => {
    this.closed = true;
    this.connectionState = 'closed';
  });
}

describe('PeerConnectionManager', () => {
  let mockSocket: WebSocketClient;
  let sentMessages: unknown[];

  beforeEach(() => {
    sentMessages = [];
    vi.spyOn(services.callService, 'getIceServers').mockResolvedValue({
      servers: [{ urls: 'stun:stun.l.google.com:19302' }],
      hasTurn: false,
      meteredConfigured: false,
    });
    mockSocket = {
      isConnected: true,
      send: vi.fn((msg: unknown) => {
        sentMessages.push(msg);
      }),
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
        sdpMid?: string | null;
        sdpMLineIndex?: number | null;
        constructor(init: RTCIceCandidateInit) {
          this.candidate = init.candidate ?? '';
          this.sdpMid = init.sdpMid;
          this.sdpMLineIndex = init.sdpMLineIndex;
        }
        toJSON() {
          return {
            candidate: this.candidate,
            sdpMid: this.sdpMid,
            sdpMLineIndex: this.sdpMLineIndex,
          };
        }
      }
    );
    vi.stubGlobal(
      'MediaStream',
      class {
        tracks: MediaStreamTrack[] = [];
        addTrack(t: MediaStreamTrack) {
          this.tracks.push(t);
        }
        getTracks() {
          return this.tracks;
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('создаёт RTCPeerConnection с переданными ICE-серверами или запрашивает их через CallService', async () => {
    const spyGetIce = vi.spyOn(services.callService, 'getIceServers').mockResolvedValueOnce({
      servers: [{ urls: 'turn:turn.crane.app:3478', username: 'u', credential: 'p' }],
      hasTurn: true,
      meteredConfigured: false,
    });

    const manager = new PeerConnectionManager({
      socket: mockSocket,
      roomId: 'room-1',
      peerId: 'peer-2',
      isPolite: false,
    });

    const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;

    expect(spyGetIce).toHaveBeenCalled();
    expect(pc.iceServers).toEqual([
      { urls: 'turn:turn.crane.app:3478', username: 'u', credential: 'p' },
    ]);
  });

  describe('Perfect Negotiation: штатный обмен offer/answer', () => {
    it('инициатор (caller) шлёт call_offer при onnegotiationneeded', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false, // Caller — impolite
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;

      // Триггерим onnegotiationneeded
      await pc.onnegotiationneeded?.();

      expect(pc.createOffer).toHaveBeenCalled();
      expect(pc.setLocalDescription).toHaveBeenCalledWith({
        type: 'offer',
        sdp: 'fake-local-offer-sdp',
      });
      expect(mockSocket.send).toHaveBeenCalledWith({
        type: 'call_offer',
        to: 'user-callee',
        roomId: 'room-1',
        payload: {
          type: 'offer',
          sdp: 'fake-local-offer-sdp',
        },
      });
    });

    it('принимающий (callee) принимает remote offer и отправляет call_answer', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-caller',
        isPolite: true, // Callee — polite
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;

      const remoteOffer = { type: 'offer' as const, sdp: 'remote-caller-sdp' };
      await manager.handleRemoteOffer(remoteOffer);

      expect(pc.setRemoteDescription).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'offer', sdp: 'remote-caller-sdp' })
      );
      expect(pc.createAnswer).toHaveBeenCalled();
      expect(pc.setLocalDescription).toHaveBeenCalledWith({
        type: 'answer',
        sdp: 'fake-local-answer-sdp',
      });
      expect(mockSocket.send).toHaveBeenCalledWith({
        type: 'call_answer',
        to: 'user-caller',
        roomId: 'room-1',
        payload: {
          type: 'answer',
          sdp: 'fake-local-answer-sdp',
        },
      });
    });

    it('инициатор принимает remote answer и переходит в stable', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      pc.signalingState = 'have-local-offer';

      await manager.handleRemoteAnswer({ type: 'answer', sdp: 'remote-answer-sdp' });

      expect(pc.setRemoteDescription).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'answer', sdp: 'remote-answer-sdp' })
      );
      expect(pc.signalingState).toBe('stable');
    });
  });

  describe('Защита от глэра (коллизия одновременных offer)', () => {
    it('вежливый пир (polite) при коллизии откатывает свой offer через rollback и принимает входящий', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-caller',
        isPolite: true, // Polite
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      // Имитируем коллизию: у нас уже есть локальный offer в процессе
      pc.signalingState = 'have-local-offer';

      const remoteOffer = { type: 'offer' as const, sdp: 'colliding-offer' };
      await manager.handleRemoteOffer(remoteOffer);

      // Проверяем, что вежливый пир откатил локальный offer
      expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: 'rollback' });
      // И установил удалённый
      expect(pc.setRemoteDescription).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'offer', sdp: 'colliding-offer' })
      );
      // И ответил на него
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'call_answer' })
      );
    });

    /* Первое согласование начинает звонящий. Встречные предложения в начале
       звонка кончались откатом у принимающего, и Chrome оставлял его дорожки
       собеседника «заглушёнными»: медиа шло, а на экране «Камера выключена»
       и выключенный микрофон. */
    describe('первое согласование начинает звонящий', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('принимающий не шлёт своё предложение, ждёт предложение звонящего и отвечает без отката', async () => {
        vi.useFakeTimers();
        const manager = new PeerConnectionManager({
          socket: mockSocket,
          roomId: 'room-1',
          peerId: 'user-caller',
          isPolite: true,
        });
        const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;

        await pc.onnegotiationneeded?.();
        expect(pc.createOffer).not.toHaveBeenCalled();

        await manager.handleRemoteOffer({ type: 'offer', sdp: 'caller-offer' });
        await vi.advanceTimersByTimeAsync(10_000);

        expect(pc.setLocalDescription).not.toHaveBeenCalledWith({ type: 'rollback' });
        expect(pc.createOffer).not.toHaveBeenCalled();
        expect(mockSocket.send).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'call_answer' })
        );
        expect(mockSocket.send).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: 'call_offer' })
        );
      });

      it('предложение звонящего не пришло — принимающий предлагает сам, чтобы звонок не повис', async () => {
        vi.useFakeTimers();
        const manager = new PeerConnectionManager({
          socket: mockSocket,
          roomId: 'room-1',
          peerId: 'user-caller',
          isPolite: true,
        });
        const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;

        await pc.onnegotiationneeded?.();
        await vi.advanceTimersByTimeAsync(4000);

        expect(pc.createOffer).toHaveBeenCalledTimes(1);
        expect(mockSocket.send).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'call_offer', to: 'user-caller' })
        );
      });

      it('close() до истечения ожидания — своё предложение не уходит', async () => {
        vi.useFakeTimers();
        const manager = new PeerConnectionManager({
          socket: mockSocket,
          roomId: 'room-1',
          peerId: 'user-caller',
          isPolite: true,
        });
        const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;

        await pc.onnegotiationneeded?.();
        manager.close();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(pc.createOffer).not.toHaveBeenCalled();
      });

      it('встречное предложение между createOffer и setLocalDescription — не ошибка', async () => {
        const onError = vi.fn();
        const manager = new PeerConnectionManager({
          socket: mockSocket,
          roomId: 'room-1',
          peerId: 'user-callee',
          isPolite: false,
          onError,
        });
        const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
        pc.setLocalDescription.mockImplementationOnce(async () => {
          pc.signalingState = 'have-remote-offer';
          throw Object.assign(new Error('Failed to set local offer'), {
            name: 'InvalidStateError',
          });
        });

        await pc.onnegotiationneeded?.();

        expect(onError).not.toHaveBeenCalled();
        expect(mockSocket.send).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: 'call_offer' })
        );
      });
    });

    it('невежливый пир (impolite) при коллизии игнорирует входящий offer и не делает rollback', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false, // Impolite
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      pc.signalingState = 'have-local-offer';

      const remoteOffer = { type: 'offer' as const, sdp: 'colliding-offer' };
      await manager.handleRemoteOffer(remoteOffer);

      // Невежливый пир НЕ делает rollback
      expect(pc.setLocalDescription).not.toHaveBeenCalledWith({ type: 'rollback' });
      // И НЕ устанавливает удалённый offer
      expect(pc.setRemoteDescription).not.toHaveBeenCalled();
      // И НЕ отправляет call_answer
      expect(mockSocket.send).not.toHaveBeenCalled();
    });
  });

  describe('Буферизация ICE-кандидатов до setRemoteDescription', () => {
    it('буферизует кандидатов, пришедших до setRemoteDescription, и выгружает их после', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-caller',
        isPolite: true,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      expect(pc.remoteDescription).toBeNull();

      // Приходят два ICE-кандидата до того, как получен offer/answer
      const candidate1 = { candidate: 'candidate:1 1 UDP ...', sdpMid: '0', sdpMLineIndex: 0 };
      const candidate2 = { candidate: 'candidate:2 1 UDP ...', sdpMid: '1', sdpMLineIndex: 1 };

      await manager.handleRemoteIce(candidate1);
      await manager.handleRemoteIce(candidate2);

      // В pc.addIceCandidate кандидаты ещё НЕ переданы
      expect(pc.addIceCandidate).not.toHaveBeenCalled();
      expect(pc.addedIceCandidates.length).toBe(0);

      // Теперь приходит offer и вызывается setRemoteDescription
      await manager.handleRemoteOffer({ type: 'offer', sdp: 'offer-sdp' });

      // После установки remoteDescription оба кандидата выгружены в pc.addIceCandidate
      expect(pc.addIceCandidate).toHaveBeenCalledTimes(2);
      expect(pc.addedIceCandidates).toEqual([
        expect.objectContaining({ candidate: candidate1.candidate }),
        expect.objectContaining({ candidate: candidate2.candidate }),
      ]);
    });

    it('кандидаты, пришедшие после setRemoteDescription, добавляются сразу', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-caller',
        isPolite: true,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      await manager.handleRemoteOffer({ type: 'offer', sdp: 'offer-sdp' });

      const candidate = { candidate: 'candidate:late 1 UDP ...', sdpMid: '0', sdpMLineIndex: 0 };
      await manager.handleRemoteIce(candidate);

      expect(pc.addIceCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ candidate: candidate.candidate })
      );
    });
  });

  describe('Смена треков через replaceTrack', () => {
    it('меняет трек в существующем сендере на лету без пересоздания соединения', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;

      const initialTrack = { kind: 'video', id: 'cam-initial' } as MediaStreamTrack;
      pc.addTrack(initialTrack);

      expect(pc.senders.length).toBe(1);
      const sender = pc.senders[0];

      // Заменяем трек камеры на новый
      const newTrack = { kind: 'video', id: 'cam-switched' } as MediaStreamTrack;
      await manager.replaceTrack('video', newTrack);

      expect(sender.replaceTrack).toHaveBeenCalledWith(newTrack);
      expect(sender.track).toBe(newTrack);
      // Соединение не закрывалось
      expect(pc.close).not.toHaveBeenCalled();
    });
  });

  describe('Приоритет звука (#948)', () => {
    const makeManager = () =>
      new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false,
      });

    const priorities = (sender: MockRTCRtpSender) =>
      (sender.parameters.encodings ?? []).map((e) => `${e.priority}/${e.networkPriority}`);

    it('соединение установилось — звуку высокий приоритет, видео не меняется', async () => {
      const manager = makeManager();
      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      pc.addTrack({ kind: 'audio', id: 'mic' } as MediaStreamTrack);
      pc.addTrack({ kind: 'video', id: 'cam' } as MediaStreamTrack);
      const [audio, video] = pc.senders;

      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();

      expect(priorities(audio)).toEqual(['high/high']);
      expect(video.setParameters).not.toHaveBeenCalled();
      expect(priorities(video)).toEqual(['low/low']);
    });

    it('до согласования кодировок нет — приоритет не трогается', async () => {
      const manager = makeManager();
      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      pc.addTrack({ kind: 'audio', id: 'mic' } as MediaStreamTrack);
      pc.senders[0].parameters = { encodings: [] } as unknown as RTCRtpSendParameters;

      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();

      expect(pc.senders[0].setParameters).not.toHaveBeenCalled();
    });

    it('замена звукового трека — приоритет высокий и у нового', async () => {
      const manager = makeManager();
      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      pc.addTrack({ kind: 'audio', id: 'mic' } as MediaStreamTrack);

      await manager.replaceTrack('audio', { kind: 'audio', id: 'processed' } as MediaStreamTrack);

      expect(priorities(pc.senders[0])).toEqual(['high/high']);
    });

    it('уже высокий — повторно не ставится', async () => {
      const manager = makeManager();
      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      pc.addTrack({ kind: 'audio', id: 'mic' } as MediaStreamTrack);

      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();
      pc.onconnectionstatechange?.();

      expect(pc.senders[0].setParameters).toHaveBeenCalledTimes(1);
    });
  });

  describe('Состояния соединения и уборка', () => {
    it('передаёт изменения connectionState через коллбэк', async () => {
      const onConnectionStateChange = vi.fn();

      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false,
        onConnectionStateChange,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;

      pc.connectionState = 'connecting';
      pc.onconnectionstatechange?.();
      expect(onConnectionStateChange).toHaveBeenCalledWith('connecting');

      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();
      expect(onConnectionStateChange).toHaveBeenCalledWith('connected');

      pc.connectionState = 'disconnected';
      pc.onconnectionstatechange?.();
      expect(onConnectionStateChange).toHaveBeenCalledWith('disconnected');
    });

    it('close() закрывает соединение и очищает слушатели', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;

      manager.close();

      expect(pc.close).toHaveBeenCalled();
      expect(pc.onicecandidate).toBeNull();
      expect(pc.ontrack).toBeNull();
      expect(pc.onnegotiationneeded).toBeNull();
      expect(pc.onconnectionstatechange).toBeNull();
    });

    it('не теряет входящий offer и ICE, пришедшие во время запроса ICE-серверов', async () => {
      let resolveIce!: (val: {
        servers: { urls: string }[];
        hasTurn: boolean;
        meteredConfigured: boolean;
      }) => void;
      vi.spyOn(services.callService, 'getIceServers').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveIce = resolve;
          })
      );

      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-caller',
        isPolite: true,
      });

      // Запускаем инициализацию, которая зависает на getIceServers
      const initPromise = manager.initialize();
      expect(manager.getPeerConnection()).toBeNull();

      // Сигналы приходят до завершения getIceServers
      const offerPromise = manager.handleRemoteOffer({
        type: 'offer',
        sdp: 'remote-offer-pending-ice',
      });
      const icePromise = manager.handleRemoteIce({
        candidate: 'candidate:pending 1 UDP ...',
        sdpMid: '0',
        sdpMLineIndex: 0,
      });

      // Теперь бэкенд возвращает ICE-серверы
      resolveIce({
        servers: [{ urls: 'turn:turn.ourserver.com' }],
        hasTurn: true,
        meteredConfigured: false,
      });

      await initPromise;
      await offerPromise;
      await icePromise;

      const pc = manager.getPeerConnection() as unknown as MockRTCPeerConnection;
      expect(pc).not.toBeNull();
      expect(pc.setRemoteDescription).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'offer', sdp: 'remote-offer-pending-ice' })
      );
      expect(pc.addIceCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ candidate: 'candidate:pending 1 UDP ...' })
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'call_answer' })
      );
    });

    it('передаёт ошибку в onError при невалидном SDP вместо необработанного исключения', async () => {
      const onError = vi.fn();
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-caller',
        isPolite: true,
        onError,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      pc.setRemoteDescription.mockRejectedValueOnce(new Error('Invalid SDP syntax'));

      await manager.handleRemoteOffer({ type: 'offer', sdp: 'malformed-sdp' });

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid SDP syntax' })
      );
    });

    it('поддерживает ответ сервера с ключом iceServers вместо servers', async () => {
      vi.spyOn(services.callService, 'getIceServers').mockResolvedValueOnce({
        iceServers: [{ urls: 'stun:stun.backend.com:19302' }],
      } as unknown as { servers: [] });

      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-backend',
        peerId: 'user-callee',
        isPolite: false,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      expect(pc).not.toBeNull();
      expect(pc.iceServers).toEqual([
        {
          urls: 'stun:stun.backend.com:19302',
          username: undefined,
          credential: undefined,
        },
      ]);
    });

    it('вызывает onError, если getIceServers завершился с ошибкой сети', async () => {
      const onError = vi.fn();
      vi.spyOn(services.callService, 'getIceServers').mockRejectedValueOnce(
        new Error('Network error 503')
      );

      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-caller',
        isPolite: false,
        onError,
      });

      const pc = await manager.initialize();
      expect(pc).toBeNull();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('503') })
      );
    });

    it('setLocalStream(null) заменяет треки во всех сендерах на null', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      const initialTrack = { kind: 'video', id: 'cam-initial' } as MediaStreamTrack;
      pc.addTrack(initialTrack);

      const sender = pc.senders[0];
      manager.setLocalStream(null);

      expect(sender.replaceTrack).toHaveBeenCalledWith(null);
    });

    it('после close() игнорирует запоздалые offer, answer и ICE, не создавая повторный RTCPeerConnection', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: true,
      });

      await manager.initialize();
      manager.close();

      sentMessages = [];

      // Запоздалый offer
      await manager.handleRemoteOffer({ type: 'offer', sdp: 'late-offer' });
      expect(sentMessages).toHaveLength(0);
      expect(manager.getPeerConnection()).toBeNull();

      // Запоздалый ice
      await manager.handleRemoteIce({ candidate: 'late-ice', sdpMid: '0', sdpMLineIndex: 0 });
      expect(manager.getPeerConnection()).toBeNull();

      // Запоздалый answer
      await manager.handleRemoteAnswer({ type: 'answer', sdp: 'late-answer' });
      expect(manager.getPeerConnection()).toBeNull();

      // Повторный initialize после close возвращает null
      const reinit = await manager.initialize();
      expect(reinit).toBeNull();
    });

    it('restartIce() вызывает pc.restartIce() и отправляет новый offer c iceRestart: true', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      sentMessages = [];

      await manager.restartIce();

      expect(pc.restartIce).toHaveBeenCalledTimes(1);
      expect(pc.createOffer).toHaveBeenCalledWith({ iceRestart: true });
      expect(pc.setLocalDescription).toHaveBeenCalled();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toEqual({
        type: 'call_offer',
        to: 'user-callee',
        roomId: 'room-1',
        payload: {
          type: 'offer',
          sdp: 'fake-local-offer-sdp',
        },
      });
    });

    it('restartIce() не выполняет действий, если менеджер закрыт', async () => {
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      manager.close();
      sentMessages = [];

      await manager.restartIce();

      expect(pc.createOffer).not.toHaveBeenCalled();
      expect(sentMessages).toHaveLength(0);
    });

    it('вычисляет эмодзи сверки ключа при подключении и сбрасывает при отключении/закрытии', async () => {
      const onVerificationEmojisChange = vi.fn();
      const manager = new PeerConnectionManager({
        socket: mockSocket,
        roomId: 'room-1',
        peerId: 'user-callee',
        isPolite: false,
        onVerificationEmojisChange,
      });

      const pc = (await manager.initialize()) as unknown as MockRTCPeerConnection;
      pc.localDescription = {
        type: 'offer',
        sdp: 'v=0\r\na=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\r\n',
      };
      pc.remoteDescription = {
        type: 'answer',
        sdp: 'v=0\r\na=fingerprint:sha-256 FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00\r\n',
      };

      expect(manager.getVerificationEmojis()).toBeNull();

      // Переход в connected
      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();

      // Ожидаем асинхронное вычисление sha256
      await vi.waitFor(() => {
        expect(onVerificationEmojisChange).toHaveBeenCalled();
      });

      const emojis = manager.getVerificationEmojis();
      expect(emojis).toHaveLength(4);
      expect(onVerificationEmojisChange).toHaveBeenLastCalledWith(emojis);

      // Переход в disconnected
      pc.connectionState = 'disconnected';
      pc.onconnectionstatechange?.();

      expect(manager.getVerificationEmojis()).toBeNull();
      expect(onVerificationEmojisChange).toHaveBeenLastCalledWith(null);

      // Восстановление в connected
      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();

      await vi.waitFor(() => {
        expect(manager.getVerificationEmojis()).toEqual(emojis);
      });

      // Закрытие менеджера сбрасывает эмодзи
      manager.close();
      expect(manager.getVerificationEmojis()).toBeNull();
      expect(onVerificationEmojisChange).toHaveBeenLastCalledWith(null);
    });
  });
});
