import type {
  ILocalMediaState,
  IMediaDeviceOption,
  IMediaError,
  IStartMediaOptions,
  TFacingMode,
} from './types';

export const MEDIA_PERMISSION_TIMEOUT_MS = 20000;

export function parseMediaError(err: unknown): IMediaError {
  if (!err) {
    return {
      type: 'UnknownMediaError',
      name: 'UnknownMediaError',
      message: 'Unknown media error',
    };
  }

  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : 'UnknownMediaError';

  const rawMessage =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        type: 'NotAllowedError',
        name,
        message: rawMessage || 'Permission denied',
        originalError: err,
      };

    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        type: 'NotFoundError',
        name,
        message: rawMessage || 'Requested device not found',
        originalError: err,
      };

    case 'NotReadableError':
    case 'TrackStartError':
      return {
        type: 'NotReadableError',
        name,
        message: rawMessage || 'Device is not readable or already in use',
        originalError: err,
      };

    case 'OverconstrainedError':
      return {
        type: 'OverconstrainedError',
        name,
        message: rawMessage || 'Overconstrained track settings',
        originalError: err,
      };

    case 'InsecureContextError':
      return {
        type: 'InsecureContextError',
        name,
        message: rawMessage || 'Media devices not available in insecure context',
        originalError: err,
      };

    case 'TimeoutError':
      return {
        type: 'TimeoutError',
        name,
        message: rawMessage || 'Media permission request timed out',
        originalError: err,
      };

    default:
      return {
        type: 'UnknownMediaError',
        name,
        message: rawMessage || 'Media error occurred',
        originalError: err,
      };
  }
}

export type TTrackReplacedCallback = (
  kind: 'audio' | 'video',
  oldTrack: MediaStreamTrack | null,
  newTrack: MediaStreamTrack
) => void;

export class LocalMediaManager {
  private state: ILocalMediaState = {
    stream: null,
    audioTrack: null,
    videoTrack: null,
    isAudioMuted: false,
    isVideoMuted: false,
    audioInputs: [],
    videoInputs: [],
    selectedAudioDeviceId: null,
    selectedVideoDeviceId: null,
    facingMode: 'user',
    error: null,
    isLoading: false,
  };

  private listeners = new Set<(state: ILocalMediaState) => void>();
  private trackReplacedListeners = new Set<TTrackReplacedCallback>();
  private isListeningDeviceChange = false;

  private startOperationId = 0;
  private cameraSwitchOpId = 0;
  private micSwitchOpId = 0;
  private isStopped = false;

  constructor() {
    this.handleDeviceChange = this.handleDeviceChange.bind(this);
  }

  getState(): ILocalMediaState {
    return { ...this.state };
  }

  subscribe(listener: (state: ILocalMediaState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  onTrackReplaced(callback: TTrackReplacedCallback): () => void {
    this.trackReplacedListeners.add(callback);
    return () => {
      this.trackReplacedListeners.delete(callback);
    };
  }

  private notify(): void {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(currentState);
      } catch {
        // Игнорируем ошибки слушателей интерфейса
      }
    }
  }

  private bindTrackEnded(track: MediaStreamTrack): void {
    track.onended = () => {
      if (this.isStopped) return;

      if (track.kind === 'audio' && this.state.audioTrack === track) {
        this.state.audioTrack = null;
        this.state.error = {
          type: 'NotFoundError',
          name: 'NotFoundError',
          message: 'Audio device disconnected',
        };
        this.notify();
      } else if (track.kind === 'video' && this.state.videoTrack === track) {
        this.state.videoTrack = null;
        this.state.isVideoMuted = true;
        this.state.error = {
          type: 'NotFoundError',
          name: 'NotFoundError',
          message: 'Video device disconnected',
        };
        this.notify();
      }
    };
  }

  async startMedia(options: IStartMediaOptions = {}): Promise<MediaStream | null> {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.mediaDevices?.getUserMedia) {
      const err = parseMediaError({ name: 'InsecureContextError' });
      this.state.error = err;
      this.state.isLoading = false;
      this.notify();
      return null;
    }

    this.isStopped = false;
    const currentOpId = ++this.startOperationId;
    this.cameraSwitchOpId++;
    this.micSwitchOpId++;

    this.state.isLoading = true;
    this.state.error = null;
    this.notify();

    const isAudioOnly = options.kind === 'audio';

    const audioConstraints: MediaTrackConstraints | boolean =
      options.audio !== undefined
        ? options.audio
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(options.audioDeviceId ? { deviceId: { exact: options.audioDeviceId } } : {}),
          };

    const videoConstraints: MediaTrackConstraints | boolean = isAudioOnly
      ? false
      : options.video !== undefined
        ? options.video
        : {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: options.facingMode ?? this.state.facingMode,
            ...(options.videoDeviceId ? { deviceId: { exact: options.videoDeviceId } } : {}),
          };

    const timeoutMs = options.timeoutMs ?? MEDIA_PERMISSION_TIMEOUT_MS;

    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let hasTimedOut = false;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          hasTimedOut = true;
          const timeoutErr = new Error('Permission request timed out');
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        }, timeoutMs);
      });

      const gumPromise = nav.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints,
      });

      gumPromise
        .then((lateStream) => {
          if (hasTimedOut || this.isStopped || this.startOperationId !== currentOpId) {
            for (const t of lateStream.getTracks()) {
              try {
                t.stop();
              } catch {
                // Игнорируем
              }
            }
          }
        })
        .catch(() => {
          // Игнорируем поздние ошибки
        });

      const stream = await Promise.race([gumPromise, timeoutPromise]).finally(() => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      });

      // Если пока шёл запрос разрешения пользователь отменил звонок — останавливаем треки немедленно
      if (this.isStopped || this.startOperationId !== currentOpId) {
        for (const t of stream.getTracks()) {
          try {
            t.stop();
          } catch {
            // Игнорируем
          }
        }
        return null;
      }

      // Останавливаем старые треки, если они существовали
      if (this.state.stream && this.state.stream !== stream) {
        for (const t of this.state.stream.getTracks()) {
          try {
            t.stop();
          } catch {
            // Игнорируем
          }
        }
      }

      const audioTrack = stream.getAudioTracks()[0] ?? null;
      const videoTrack = stream.getVideoTracks()[0] ?? null;

      if (audioTrack) {
        audioTrack.enabled = !this.state.isAudioMuted;
        this.bindTrackEnded(audioTrack);
      }
      if (videoTrack) {
        videoTrack.enabled = !this.state.isVideoMuted;
        this.bindTrackEnded(videoTrack);
      }

      this.state.stream = stream;
      this.state.audioTrack = audioTrack;
      this.state.videoTrack = videoTrack;

      if (options.audioDeviceId) {
        this.state.selectedAudioDeviceId = options.audioDeviceId;
      }
      if (options.videoDeviceId) {
        this.state.selectedVideoDeviceId = options.videoDeviceId;
      }
      if (options.facingMode) {
        this.state.facingMode = options.facingMode;
      }

      this.state.isLoading = false;
      this.state.error = null;

      await this.enumerateDevices();
      this.notify();
      return stream;
    } catch (rawError) {
      if (this.isStopped || this.startOperationId !== currentOpId) {
        return null;
      }

      const mediaError = parseMediaError(rawError);

      // Fallback: если видеозвонок не удался из-за недоступности камеры, пробуем запросить только аудио
      if (
        !isAudioOnly &&
        (mediaError.type === 'NotFoundError' ||
          mediaError.type === 'NotReadableError' ||
          mediaError.type === 'OverconstrainedError')
      ) {
        try {
          const audioOnlyStream = await nav.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false,
          });

          if (this.isStopped || this.startOperationId !== currentOpId) {
            for (const t of audioOnlyStream.getTracks()) {
              try {
                t.stop();
              } catch {
                // Игнорируем
              }
            }
            return null;
          }

          // Останавливаем прежний стрим при fallback на аудио
          if (this.state.stream && this.state.stream !== audioOnlyStream) {
            for (const t of this.state.stream.getTracks()) {
              try {
                t.stop();
              } catch {
                // Игнорируем
              }
            }
          }

          const audioTrack = audioOnlyStream.getAudioTracks()[0] ?? null;
          if (audioTrack) {
            audioTrack.enabled = !this.state.isAudioMuted;
            this.bindTrackEnded(audioTrack);
          }

          this.state.stream = audioOnlyStream;
          this.state.audioTrack = audioTrack;
          this.state.videoTrack = null;
          this.state.isVideoMuted = true;
          this.state.error = mediaError; // Сохраняем ошибку камеры для показа в UI
          this.state.isLoading = false;

          await this.enumerateDevices();
          this.notify();
          return audioOnlyStream;
        } catch {
          // Если и аудио не удалось, падаем в общую ошибку
        }
      }

      if (mediaError.type === 'TimeoutError') {
        this.startOperationId++;
      }

      this.state.error = mediaError;
      this.state.isLoading = false;
      this.notify();
      return null;
    }
  }

  toggleAudio(enabled?: boolean): boolean {
    const nextEnabled = enabled !== undefined ? enabled : this.state.isAudioMuted;
    this.state.isAudioMuted = !nextEnabled;
    if (this.state.audioTrack) {
      this.state.audioTrack.enabled = nextEnabled;
    }
    this.notify();
    return nextEnabled;
  }

  toggleVideo(enabled?: boolean): boolean {
    const nextEnabled = enabled !== undefined ? enabled : this.state.isVideoMuted;
    this.state.isVideoMuted = !nextEnabled;
    if (this.state.videoTrack) {
      this.state.videoTrack.enabled = nextEnabled;
    }
    this.notify();
    return nextEnabled;
  }

  async switchCamera(deviceIdOrFacing?: string | TFacingMode): Promise<MediaStreamTrack | null> {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.mediaDevices?.getUserMedia) {
      return null;
    }

    if (this.state.isLoading) {
      return null;
    }

    // Если звонок строго голосовой и видео не инициализировано, переключение камеры не выполняется
    if (!this.state.videoTrack && !this.state.stream?.getVideoTracks().length) {
      return null;
    }

    const currentOpId = ++this.cameraSwitchOpId;

    let targetFacing: TFacingMode = this.state.facingMode;
    let targetDeviceId: string | null = null;

    if (deviceIdOrFacing === 'user' || deviceIdOrFacing === 'environment') {
      targetFacing = deviceIdOrFacing;
    } else if (deviceIdOrFacing) {
      targetDeviceId = deviceIdOrFacing;
    } else {
      targetFacing = this.state.facingMode === 'user' ? 'environment' : 'user';
    }

    const videoConstraint: MediaTrackConstraints = targetDeviceId
      ? { deviceId: { exact: targetDeviceId } }
      : { facingMode: targetFacing };

    const oldTrack = this.state.videoTrack;
    const prevFacing = this.state.facingMode;
    const prevVideoDeviceId = this.state.selectedVideoDeviceId;

    // Останавливаем старый трек перед запросом нового (критично для мобильных устройств,
    // где две камеры не могут работать одновременно и вызывают NotReadableError)
    if (oldTrack) {
      try {
        oldTrack.onended = null;
        oldTrack.stop();
      } catch {
        // Игнорируем
      }
      if (this.state.stream) {
        try {
          this.state.stream.removeTrack(oldTrack);
        } catch {
          // Игнорируем
        }
      }
    }

    try {
      const tempStream = await nav.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: false,
      });

      if (this.isStopped || this.cameraSwitchOpId !== currentOpId) {
        for (const t of tempStream.getTracks()) {
          try {
            t.stop();
          } catch {
            // Игнорируем
          }
        }
        return null;
      }

      const newTrack = tempStream.getVideoTracks()[0];
      if (!newTrack) return null;

      newTrack.enabled = !this.state.isVideoMuted;
      this.bindTrackEnded(newTrack);

      if (this.state.stream) {
        this.state.stream.addTrack(newTrack);
      }

      this.state.videoTrack = newTrack;
      this.state.facingMode = targetFacing;
      this.state.selectedVideoDeviceId = targetDeviceId;

      for (const cb of this.trackReplacedListeners) {
        try {
          cb('video', oldTrack, newTrack);
        } catch {
          // Игнорируем
        }
      }

      this.notify();
      return newTrack;
    } catch (rawError) {
      this.state.error = parseMediaError(rawError);

      // Восстанавливаем прежнюю камеру при ошибке
      if (!this.isStopped && this.cameraSwitchOpId === currentOpId) {
        try {
          const fallbackConstraint: MediaTrackConstraints = prevVideoDeviceId
            ? { deviceId: { exact: prevVideoDeviceId } }
            : { facingMode: prevFacing };

          const fallbackStream = await nav.mediaDevices.getUserMedia({
            video: fallbackConstraint,
            audio: false,
          });

          if (!this.isStopped && this.cameraSwitchOpId === currentOpId) {
            const restoredTrack = fallbackStream.getVideoTracks()[0];
            if (restoredTrack) {
              restoredTrack.enabled = !this.state.isVideoMuted;
              this.bindTrackEnded(restoredTrack);

              if (this.state.stream) {
                this.state.stream.addTrack(restoredTrack);
              }

              this.state.videoTrack = restoredTrack;
              this.state.facingMode = prevFacing;
              this.state.selectedVideoDeviceId = prevVideoDeviceId;

              for (const cb of this.trackReplacedListeners) {
                try {
                  cb('video', oldTrack, restoredTrack);
                } catch {
                  // Игнорируем
                }
              }
            } else {
              this.state.videoTrack = null;
            }
          } else {
            for (const t of fallbackStream.getTracks()) {
              try {
                t.stop();
              } catch {
                // Игнорируем
              }
            }
          }
        } catch {
          this.state.videoTrack = null;
        }
      } else {
        this.state.videoTrack = null;
      }

      this.notify();
      return null;
    }
  }

  async switchMicrophone(deviceId: string): Promise<MediaStreamTrack | null> {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.mediaDevices?.getUserMedia) {
      return null;
    }

    if (this.state.isLoading) {
      return null;
    }

    const currentOpId = ++this.micSwitchOpId;
    const oldTrack = this.state.audioTrack;
    const prevDeviceId = this.state.selectedAudioDeviceId;

    if (oldTrack) {
      try {
        oldTrack.onended = null;
        oldTrack.stop();
      } catch {
        // Игнорируем
      }
      if (this.state.stream) {
        try {
          this.state.stream.removeTrack(oldTrack);
        } catch {
          // Игнорируем
        }
      }
    }

    try {
      const tempStream = await nav.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });

      if (this.isStopped || this.micSwitchOpId !== currentOpId) {
        for (const t of tempStream.getTracks()) {
          try {
            t.stop();
          } catch {
            // Игнорируем
          }
        }
        return null;
      }

      const newTrack = tempStream.getAudioTracks()[0];
      if (!newTrack) return null;

      newTrack.enabled = !this.state.isAudioMuted;
      this.bindTrackEnded(newTrack);

      if (this.state.stream) {
        this.state.stream.addTrack(newTrack);
      }

      this.state.audioTrack = newTrack;
      this.state.selectedAudioDeviceId = deviceId;

      for (const cb of this.trackReplacedListeners) {
        try {
          cb('audio', oldTrack, newTrack);
        } catch {
          // Игнорируем
        }
      }

      this.notify();
      return newTrack;
    } catch (rawError) {
      this.state.error = parseMediaError(rawError);

      // Восстанавливаем прежний микрофон при ошибке
      if (!this.isStopped && this.micSwitchOpId === currentOpId) {
        try {
          const fallbackConstraint: boolean | MediaTrackConstraints = prevDeviceId
            ? { deviceId: { exact: prevDeviceId } }
            : true;

          const fallbackStream = await nav.mediaDevices.getUserMedia({
            audio: fallbackConstraint,
            video: false,
          });

          if (!this.isStopped && this.micSwitchOpId === currentOpId) {
            const restoredTrack = fallbackStream.getAudioTracks()[0];
            if (restoredTrack) {
              restoredTrack.enabled = !this.state.isAudioMuted;
              this.bindTrackEnded(restoredTrack);

              if (this.state.stream) {
                this.state.stream.addTrack(restoredTrack);
              }

              this.state.audioTrack = restoredTrack;
              this.state.selectedAudioDeviceId = prevDeviceId;

              for (const cb of this.trackReplacedListeners) {
                try {
                  cb('audio', oldTrack, restoredTrack);
                } catch {
                  // Игнорируем
                }
              }
            } else {
              this.state.audioTrack = null;
            }
          } else {
            for (const t of fallbackStream.getTracks()) {
              try {
                t.stop();
              } catch {
                // Игнорируем
              }
            }
          }
        } catch {
          this.state.audioTrack = null;
        }
      } else {
        this.state.audioTrack = null;
      }

      this.notify();
      return null;
    }
  }

  async enumerateDevices(): Promise<{
    audioInputs: IMediaDeviceOption[];
    videoInputs: IMediaDeviceOption[];
  }> {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.mediaDevices?.enumerateDevices) {
      return { audioInputs: [], videoInputs: [] };
    }

    try {
      const devices = await nav.mediaDevices.enumerateDevices();
      const audioInputs: IMediaDeviceOption[] = [];
      const videoInputs: IMediaDeviceOption[] = [];

      for (const d of devices) {
        if (d.kind === 'audioinput') {
          audioInputs.push({
            deviceId: d.deviceId,
            label: d.label || `Микрофон ${audioInputs.length + 1}`,
            kind: d.kind,
            groupId: d.groupId,
          });
        } else if (d.kind === 'videoinput') {
          videoInputs.push({
            deviceId: d.deviceId,
            label: d.label || `Камера ${videoInputs.length + 1}`,
            kind: d.kind,
            groupId: d.groupId,
          });
        }
      }

      this.state.audioInputs = audioInputs;
      this.state.videoInputs = videoInputs;

      if (!this.isListeningDeviceChange && nav.mediaDevices.addEventListener) {
        nav.mediaDevices.addEventListener('devicechange', this.handleDeviceChange);
        this.isListeningDeviceChange = true;
      }

      return { audioInputs, videoInputs };
    } catch {
      return { audioInputs: [], videoInputs: [] };
    }
  }

  private handleDeviceChange(): void {
    void this.enumerateDevices().then(() => this.notify());
  }

  stopMedia(): void {
    this.isStopped = true;
    this.startOperationId++;
    this.cameraSwitchOpId++;
    this.micSwitchOpId++;

    if (this.state.stream) {
      for (const track of this.state.stream.getTracks()) {
        try {
          track.onended = null;
          track.stop();
        } catch {
          // Игнорируем
        }
      }
    }
    if (this.state.audioTrack) {
      try {
        this.state.audioTrack.onended = null;
        this.state.audioTrack.stop();
      } catch {
        // Игнорируем
      }
    }
    if (this.state.videoTrack) {
      try {
        this.state.videoTrack.onended = null;
        this.state.videoTrack.stop();
      } catch {
        // Игнорируем
      }
    }

    this.state.stream = null;
    this.state.audioTrack = null;
    this.state.videoTrack = null;
    this.state.isLoading = false;

    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (this.isListeningDeviceChange && nav?.mediaDevices?.removeEventListener) {
      nav.mediaDevices.removeEventListener('devicechange', this.handleDeviceChange);
      this.isListeningDeviceChange = false;
    }

    this.notify();
  }
}
