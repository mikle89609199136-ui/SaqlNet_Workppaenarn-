import type { WebSocketClient } from '@/services/WebSocketClient';
import { services } from '@/services/serviceContainer';
import { sendCallAnswer, sendCallIce, sendCallOffer } from './callSignaling';
import { computeCallVerificationEmojis } from './callKeyVerification';
import type { IIceServer } from './types';

export interface IPeerConnectionOptions {
  socket: WebSocketClient;
  roomId: string;
  peerId: string;
  isPolite: boolean; // Caller — impolite (false), Callee — polite (true)
  iceServers?: RTCIceServer[];
  localStream?: MediaStream | null;
  onRemoteStream?: (stream: MediaStream) => void;
  onRemoteTrack?: (track: MediaStreamTrack, stream: MediaStream) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onVerificationEmojisChange?: (emojis: string[] | null) => void;
  onError?: (err: Error) => void;
}

/**
 * Сколько вежливый пир (принимающий) ждёт первое предложение звонящего,
 * прежде чем предложить сам. Ждать нужно: встречные предложения в начале
 * звонка кончаются откатом у принимающего, и Chrome оставляет его дорожки
 * собеседника «заглушёнными» — медиа идёт, а на экране «Камера выключена».
 */
const POLITE_FIRST_OFFER_WAIT_MS = 4000;

/**
 * Звук в звонке важнее видео (#948): при нехватке канала первым уступает
 * видео. До согласования у отправителя нет `encodings` — поэтому приоритет
 * ставится, когда соединение установилось, и после замены звукового трека.
 */
export function raiseAudioPriority(pc: RTCPeerConnection): void {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'audio' || !sender.getParameters || !sender.setParameters) continue;
    const parameters = sender.getParameters();
    const encodings = parameters.encodings ?? [];
    if (encodings.length === 0) continue;
    if (encodings.every((e) => e.priority === 'high' && e.networkPriority === 'high')) continue;
    encodings.forEach((encoding) => {
      encoding.priority = 'high';
      encoding.networkPriority = 'high';
    });
    void sender.setParameters(parameters).catch(() => undefined);
  }
}

export class PeerConnectionManager {
  private pc: RTCPeerConnection | null = null;
  private readonly socket: WebSocketClient;
  private readonly roomId: string;
  private readonly peerId: string;
  private readonly isPolite: boolean;
  private iceServers: RTCIceServer[] = [];
  private localStream: MediaStream | null = null;

  private initPromise: Promise<RTCPeerConnection | null> | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private iceCandidatesQueue: RTCIceCandidateInit[] = [];
  private remoteStream: MediaStream;
  private isClosed = false;
  private politeWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private verificationEmojis: string[] | null = null;

  private options: IPeerConnectionOptions;

  constructor(options: IPeerConnectionOptions) {
    this.options = options;
    this.socket = options.socket;
    this.roomId = options.roomId;
    this.peerId = options.peerId;
    this.isPolite = options.isPolite;
    if (options.iceServers && options.iceServers.length > 0) {
      this.iceServers = options.iceServers;
    }
    this.localStream = options.localStream ?? null;
    this.remoteStream =
      typeof MediaStream !== 'undefined' ? new MediaStream() : ({} as MediaStream);
  }

  getPeerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  getRemoteStream(): MediaStream {
    return this.remoteStream;
  }

  getVerificationEmojis(): string[] | null {
    return this.verificationEmojis;
  }

  private async updateVerificationEmojis(): Promise<void> {
    if (!this.pc || this.isClosed) {
      if (this.verificationEmojis !== null) {
        this.verificationEmojis = null;
        this.options.onVerificationEmojisChange?.(null);
      }
      return;
    }

    const emojis = await computeCallVerificationEmojis(
      this.pc.localDescription?.sdp,
      this.pc.remoteDescription?.sdp
    );

    if (this.isClosed) return;
    this.verificationEmojis = emojis;
    this.options.onVerificationEmojisChange?.(emojis);
  }

  updateOptions(newOptions: Partial<IPeerConnectionOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }

  async initialize(): Promise<RTCPeerConnection | null> {
    if (this.isClosed) {
      return null;
    }

    if (this.pc) {
      return this.pc;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        // Запрашиваем ICE-серверы из бэкенда, если не переданы явно
        if (!this.options.iceServers || this.options.iceServers.length === 0) {
          try {
            const iceConfig = await services.callService.getIceServers();
            const rawServers =
              iceConfig?.servers ??
              (iceConfig as unknown as { iceServers?: IIceServer[] })?.iceServers;
            if (rawServers && rawServers.length > 0) {
              this.iceServers = rawServers.map((s: IIceServer) => ({
                urls: s.urls,
                username: s.username,
                credential: s.credential,
              }));
            } else {
              const err = new Error('Сервер звонков недоступен: список ICE-серверов пуст');
              this.options.onError?.(err);
              return null;
            }
          } catch (fetchErr) {
            const err = new Error(
              `Сервер звонков недоступен: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
            );
            this.options.onError?.(err);
            return null;
          }
        }

        if (this.isClosed) {
          return null;
        }

        const PeerConnectionClass =
          typeof RTCPeerConnection !== 'undefined'
            ? RTCPeerConnection
            : (window as unknown as { RTCPeerConnection: typeof RTCPeerConnection })
                .RTCPeerConnection;

        const pc = new PeerConnectionClass({ iceServers: this.iceServers });
        this.pc = pc;

        // Perfect Negotiation: обработка необходимости согласования.
        // Первое согласование начинает звонящий: принимающий (вежливый)
        // ждёт его предложение и отвечает, а сам предлагает, только если
        // оно так и не пришло.
        pc.onnegotiationneeded = () => {
          if (this.isPolite && !pc.remoteDescription) {
            this.waitForFirstOffer(pc);
            return;
          }
          return this.makeOffer(pc);
        };

        // Отправка локальных ICE-кандидатов собеседнику
        pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
          if (event.candidate && this.socket.isConnected) {
            const candidatePayload = event.candidate.toJSON
              ? event.candidate.toJSON()
              : {
                  candidate: event.candidate.candidate,
                  sdpMid: event.candidate.sdpMid,
                  sdpMLineIndex: event.candidate.sdpMLineIndex,
                  usernameFragment: event.candidate.usernameFragment,
                };

            sendCallIce(this.socket, {
              to: this.peerId,
              roomId: this.roomId,
              payload: candidatePayload as RTCIceCandidateInit,
            });
          }
        };

        // Приём удалённых треков
        pc.ontrack = (event: RTCTrackEvent) => {
          if (event.streams && event.streams[0]) {
            this.remoteStream = event.streams[0];
          } else if (this.remoteStream.addTrack) {
            this.remoteStream.addTrack(event.track);
          }
          this.options.onRemoteTrack?.(event.track, this.remoteStream);
          this.options.onRemoteStream?.(this.remoteStream);
        };

        // Состояние соединения
        pc.onconnectionstatechange = () => {
          if (!this.pc) return;
          if (this.pc.connectionState === 'connected') {
            raiseAudioPriority(this.pc);
            void this.updateVerificationEmojis();
          } else if (
            this.pc.connectionState === 'disconnected' ||
            this.pc.connectionState === 'failed' ||
            this.pc.connectionState === 'closed'
          ) {
            this.verificationEmojis = null;
            this.options.onVerificationEmojisChange?.(null);
          }
          this.options.onConnectionStateChange?.(this.pc.connectionState);
        };

        // Fallback на iceConnectionState, если connectionState не поддерживается
        pc.oniceconnectionstatechange = () => {
          if (!this.pc) return;
          if (!this.pc.connectionState) {
            const iceState = this.pc.iceConnectionState;
            let mappedState: RTCPeerConnectionState = 'new';
            if (iceState === 'connected' || iceState === 'completed') {
              mappedState = 'connected';
              void this.updateVerificationEmojis();
            } else if (iceState === 'disconnected') {
              mappedState = 'disconnected';
              this.verificationEmojis = null;
              this.options.onVerificationEmojisChange?.(null);
            } else if (iceState === 'failed') {
              mappedState = 'failed';
              this.verificationEmojis = null;
              this.options.onVerificationEmojisChange?.(null);
            } else if (iceState === 'closed') {
              mappedState = 'closed';
              this.verificationEmojis = null;
              this.options.onVerificationEmojisChange?.(null);
            }
            this.options.onConnectionStateChange?.(mappedState);
          }
        };

        // Добавляем треки локального медиапотока, если он уже готов
        if (this.localStream) {
          for (const track of this.localStream.getTracks()) {
            pc.addTrack(track, this.localStream);
          }
        }

        return pc;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  private waitForFirstOffer(pc: RTCPeerConnection): void {
    if (this.politeWaitTimer) return;
    this.politeWaitTimer = setTimeout(() => {
      this.politeWaitTimer = null;
      if (this.isClosed || this.pc !== pc || pc.remoteDescription) return;
      void this.makeOffer(pc);
    }, POLITE_FIRST_OFFER_WAIT_MS);
  }

  private async makeOffer(pc: RTCPeerConnection): Promise<void> {
    try {
      this.makingOffer = true;
      const offer = await pc.createOffer();
      if (!this.pc || this.isClosed || pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      if (!this.pc || this.isClosed) return;

      if (pc.localDescription && this.socket.isConnected) {
        sendCallOffer(this.socket, {
          to: this.peerId,
          roomId: this.roomId,
          payload: {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          },
        });
      }
    } catch (err) {
      // Встречное предложение успело прийти между createOffer и
      // setLocalDescription: наше устарело, согласование идёт по чужому.
      if ((err as Error)?.name === 'InvalidStateError' && pc.signalingState !== 'stable') return;
      this.options.onError?.(err as Error);
    } finally {
      this.makingOffer = false;
    }
  }

  private async ensureInitialized(): Promise<RTCPeerConnection | null> {
    if (this.isClosed) {
      return null;
    }
    if (this.pc) {
      return this.pc;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    return this.initialize();
  }

  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
    if (!this.pc || this.isClosed) return;

    if (stream) {
      for (const track of stream.getTracks()) {
        const senders = this.pc.getSenders();
        const sender = senders.find((s) => s.track && s.track.kind === track.kind);
        if (sender) {
          void sender.replaceTrack(track);
        } else {
          this.pc.addTrack(track, stream);
        }
      }
    } else {
      for (const sender of this.pc.getSenders()) {
        void sender.replaceTrack(null);
      }
    }
  }

  async replaceTrack(kind: 'audio' | 'video', newTrack: MediaStreamTrack | null): Promise<void> {
    if (this.isClosed) return;
    const pc = await this.ensureInitialized();
    if (!pc || this.isClosed) return;

    const senders = pc.getSenders();
    let sender = senders.find((s) => s.track && s.track.kind === kind);

    if (!sender && pc.getTransceivers) {
      const transceiver = pc
        .getTransceivers()
        .find((t) => t.sender.track?.kind === kind || t.receiver?.track?.kind === kind);
      if (transceiver) {
        sender = transceiver.sender;
      }
    }

    if (sender) {
      await sender.replaceTrack(newTrack);
    } else if (newTrack) {
      pc.addTrack(newTrack, this.localStream ?? undefined);
    }
    if (kind === 'audio') raiseAudioPriority(pc);
  }

  async restartIce(): Promise<void> {
    if (this.isClosed) return;
    const pc = await this.ensureInitialized();
    if (!pc || this.isClosed) return;

    try {
      if (typeof pc.restartIce === 'function') {
        pc.restartIce();
      }
      if (pc.signalingState !== 'stable' || this.makingOffer) return;

      this.makingOffer = true;
      const offer = await pc.createOffer({ iceRestart: true });
      if (!this.pc || this.isClosed || pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      if (!this.pc || this.isClosed) return;

      if (pc.localDescription && this.socket.isConnected) {
        sendCallOffer(this.socket, {
          to: this.peerId,
          roomId: this.roomId,
          payload: {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          },
        });
      }
    } catch (err) {
      this.options.onError?.(err as Error);
    } finally {
      this.makingOffer = false;
    }
  }

  async handleRemoteOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (this.isClosed) return;
    const pc = await this.ensureInitialized();
    if (!pc || this.isClosed) return;

    try {
      const readyForOffer =
        !this.makingOffer && (pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);

      const offerCollision = !readyForOffer;

      this.ignoreOffer = !this.isPolite && offerCollision;
      if (this.ignoreOffer) {
        return; // Невежливый пир игнорирует коллизию
      }

      if (offerCollision) {
        // Вежливый пир откатывает свой незавершённый offer
        await pc.setLocalDescription({ type: 'rollback' });
        if (!this.pc || this.isClosed) return;
      }

      const SessionDescriptionClass =
        typeof RTCSessionDescription !== 'undefined'
          ? RTCSessionDescription
          : (window as unknown as { RTCSessionDescription: typeof RTCSessionDescription })
              .RTCSessionDescription;

      await pc.setRemoteDescription(new SessionDescriptionClass(offer));
      if (!this.pc || this.isClosed) return;

      await this.drainIceCandidates();
      if (!this.pc || this.isClosed) return;

      const answer = await pc.createAnswer();
      if (!this.pc || this.isClosed) return;

      await pc.setLocalDescription(answer);
      if (!this.pc || this.isClosed) return;

      if (pc.localDescription && this.socket.isConnected) {
        sendCallAnswer(this.socket, {
          to: this.peerId,
          roomId: this.roomId,
          payload: {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          },
        });
      }

      if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') {
        void this.updateVerificationEmojis();
      }
    } catch (err) {
      this.options.onError?.(err as Error);
    }
  }

  async handleRemoteAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (this.isClosed) return;
    const pc = await this.ensureInitialized();
    if (!pc || this.isClosed) return;

    if (pc.signalingState === 'have-local-offer') {
      this.isSettingRemoteAnswerPending = true;
      try {
        const SessionDescriptionClass =
          typeof RTCSessionDescription !== 'undefined'
            ? RTCSessionDescription
            : (window as unknown as { RTCSessionDescription: typeof RTCSessionDescription })
                .RTCSessionDescription;

        await pc.setRemoteDescription(new SessionDescriptionClass(answer));
        if (!this.pc || this.isClosed) return;
        await this.drainIceCandidates();
        if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') {
          void this.updateVerificationEmojis();
        }
      } catch (err) {
        this.options.onError?.(err as Error);
      } finally {
        this.isSettingRemoteAnswerPending = false;
      }
    }
  }

  async handleRemoteIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.isClosed) return;
    const pc = await this.ensureInitialized();
    if (!pc || this.isClosed) return;

    // Если remoteDescription ещё не установлен — буферизуем кандидата
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      this.iceCandidatesQueue.push(candidate);
      return;
    }

    try {
      const IceCandidateClass =
        typeof RTCIceCandidate !== 'undefined'
          ? RTCIceCandidate
          : (window as unknown as { RTCIceCandidate: typeof RTCIceCandidate }).RTCIceCandidate;

      await pc.addIceCandidate(new IceCandidateClass(candidate));
    } catch (err) {
      if (!this.ignoreOffer) {
        this.options.onError?.(err as Error);
      }
    }
  }

  private async drainIceCandidates(): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) return;

    const queue = [...this.iceCandidatesQueue];
    this.iceCandidatesQueue = [];

    const IceCandidateClass =
      typeof RTCIceCandidate !== 'undefined'
        ? RTCIceCandidate
        : (window as unknown as { RTCIceCandidate: typeof RTCIceCandidate }).RTCIceCandidate;

    for (const candidate of queue) {
      try {
        await this.pc.addIceCandidate(new IceCandidateClass(candidate));
      } catch (err) {
        if (!this.ignoreOffer) {
          this.options.onError?.(err as Error);
        }
      }
    }
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.initPromise = null;
    if (this.politeWaitTimer) {
      clearTimeout(this.politeWaitTimer);
      this.politeWaitTimer = null;
    }

    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onnegotiationneeded = null;
      this.pc.onconnectionstatechange = null;
      this.pc.onsignalingstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        // RTCPeerConnection close might throw if already closed
      }
      this.pc = null;
    }

    this.iceCandidatesQueue = [];
    this.localStream = null;
    this.verificationEmojis = null;
    this.options.onVerificationEmojisChange?.(null);
  }
}
