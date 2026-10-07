import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallLobbyView } from './CallLobbyView';
import type { useLocalMedia } from '../model/useLocalMedia';

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
  constructor(tracks: FakeTrack[] = [new FakeTrack('video'), new FakeTrack('audio')]) {
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

function createMockLocalMedia(
  overrides?: Partial<ReturnType<typeof useLocalMedia>>
): ReturnType<typeof useLocalMedia> {
  return {
    stream: new FakeStream() as unknown as MediaStream,
    isAudioMuted: false,
    isVideoMuted: false,
    facingMode: 'user',
    audioInputs: [
      { deviceId: 'mic-default', label: 'Встроенный микрофон', kind: 'audioinput' },
      { deviceId: 'mic-usb', label: 'USB Микрофон', kind: 'audioinput' },
    ],
    videoInputs: [
      { deviceId: 'cam-front', label: 'Фронтальная камера', kind: 'videoinput' },
      { deviceId: 'cam-back', label: 'Основная камера', kind: 'videoinput' },
    ],
    selectedAudioDeviceId: 'mic-default',
    selectedVideoDeviceId: 'cam-front',
    startMedia: vi.fn().mockResolvedValue(null),
    stopMedia: vi.fn(),
    toggleAudio: vi.fn(),
    toggleVideo: vi.fn(),
    switchMicrophone: vi.fn().mockResolvedValue(true),
    switchCamera: vi.fn().mockResolvedValue(true),
    enumerateDevices: vi.fn().mockResolvedValue(undefined),
    onTrackReplaced: vi.fn(() => () => {}),
    isLoading: false,
    error: null,
    ...overrides,
  };
}

describe('CallLobbyView', () => {
  it('рендерит заголовок, превью, переключатели и селекторы устройств', () => {
    const onJoin = vi.fn();
    const onCancel = vi.fn();
    const localMedia = createMockLocalMedia();

    render(
      <CallLobbyView
        title="Готовы присоединиться?"
        peerName="Дмитрий"
        kind="video"
        localMedia={localMedia}
        onJoin={onJoin}
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Лобби звонка' })).toBeInTheDocument();
    expect(screen.getByText('Готовы присоединиться?')).toBeInTheDocument();
    expect(screen.getByText(/Дмитрий/)).toBeInTheDocument();
    expect(screen.getByLabelText('Ваша камера')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выключить микрофон' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выключить камеру' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Микрофон/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Камера/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Присоединиться' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeInTheDocument();
  });

  it('вызывает toggleAudio и toggleVideo при нажатии на кнопки', () => {
    const localMedia = createMockLocalMedia();
    render(<CallLobbyView localMedia={localMedia} onJoin={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Выключить микрофон' }));
    expect(localMedia.toggleAudio).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Выключить камеру' }));
    expect(localMedia.toggleVideo).toHaveBeenCalledTimes(1);
  });

  it('вызывает switchMicrophone и switchCamera при изменении селекторов', () => {
    const localMedia = createMockLocalMedia();
    render(
      <CallLobbyView kind="video" localMedia={localMedia} onJoin={vi.fn()} onCancel={vi.fn()} />
    );

    const micSelect = screen.getByRole('combobox', { name: /Микрофон/ });
    fireEvent.click(micSelect);
    const micOption = screen.getByRole('option', { name: /USB Микрофон/ });
    fireEvent.click(micOption);
    expect(localMedia.switchMicrophone).toHaveBeenCalledWith('mic-usb');

    const camSelect = screen.getByRole('combobox', { name: /Камера/ });
    fireEvent.click(camSelect);
    const camOption = screen.getByRole('option', { name: /Основная камера/ });
    fireEvent.click(camOption);
    expect(localMedia.switchCamera).toHaveBeenCalledWith('cam-back');
  });

  it('вызывает onJoin при клике по кнопке «Присоединиться»', () => {
    const onJoin = vi.fn();
    const localMedia = createMockLocalMedia();
    render(<CallLobbyView localMedia={localMedia} onJoin={onJoin} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Присоединиться' }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it('вызывает onCancel при клике по кнопке «Отмена»', () => {
    const onCancel = vi.fn();
    const localMedia = createMockLocalMedia();
    render(<CallLobbyView localMedia={localMedia} onJoin={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('скрывает селектор камеры при аудиозвонке', () => {
    const localMedia = createMockLocalMedia();
    render(
      <CallLobbyView kind="audio" localMedia={localMedia} onJoin={vi.fn()} onCancel={vi.fn()} />
    );

    expect(screen.getByRole('combobox', { name: /Микрофон/ })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Камера/ })).not.toBeInTheDocument();
  });

  it('показывает аватар заглушки при выключенной камере', () => {
    const localMedia = createMockLocalMedia({ isVideoMuted: true });
    render(
      <CallLobbyView peerName="Анна" localMedia={localMedia} onJoin={vi.fn()} onCancel={vi.fn()} />
    );

    expect(screen.queryByLabelText('Ваша камера')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Включить камеру' })).toBeInTheDocument();
  });
});
