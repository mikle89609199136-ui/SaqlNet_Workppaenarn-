import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActiveCallView } from './ActiveCallView';
import type { IActiveCall } from '../model/types';

class FakeTrack {
  kind: 'audio' | 'video';
  enabled = true;
  muted = false;
  readyState = 'live';
  stop = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  constructor(kind: 'audio' | 'video') {
    this.kind = kind;
  }
}

class FakeStream {
  private tracks: FakeTrack[] = [];
  constructor(tracks: FakeTrack[] = []) {
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
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter((track) => track !== t);
  }
}

if (typeof globalThis.MediaStream === 'undefined') {
  globalThis.MediaStream = FakeStream as unknown as typeof MediaStream;
}

describe('ActiveCallView', () => {
  const audioCall: IActiveCall = {
    roomId: 'room-101',
    type: 'p2p',
    kind: 'audio',
    peerId: 'peer-1',
    peerName: 'Алексей',
  };

  const videoCall: IActiveCall = {
    roomId: 'room-102',
    type: 'p2p',
    kind: 'video',
    peerId: 'peer-2',
    peerName: 'Елена',
  };

  it('рендерит аудиозвонок: имя, аватар и кнопки управления', () => {
    const onToggleAudio = vi.fn();
    const onToggleVideo = vi.fn();
    const onMinimize = vi.fn();
    const onEndCall = vi.fn();

    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now() - 5000}
        onToggleAudio={onToggleAudio}
        onToggleVideo={onToggleVideo}
        onMinimize={onMinimize}
        onEndCall={onEndCall}
      />
    );

    expect(screen.getAllByText('Алексей').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Выключить микрофон' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Включить камеру' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Свернуть звонок' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
  });

  it('вызывает onToggleAudio при клике по микрофону', () => {
    const onToggleAudio = vi.fn();

    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        onToggleAudio={onToggleAudio}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Выключить микрофон' }));
    expect(onToggleAudio).toHaveBeenCalledTimes(1);
  });

  it('вызывает onToggleVideo при клике по кнопке камеры', () => {
    const onToggleVideo = vi.fn();

    render(
      <ActiveCallView
        activeCall={videoCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        onToggleAudio={vi.fn()}
        onToggleVideo={onToggleVideo}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    expect(onToggleVideo).toHaveBeenCalledTimes(1);
  });

  it('вызывает onMinimize при клике по кнопке сворачивания', () => {
    const onMinimize = vi.fn();

    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={onMinimize}
        onEndCall={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть звонок' }));
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it('вызывает onEndCall при клике по кнопке завершения', () => {
    const onEndCall = vi.fn();

    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={onEndCall}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    expect(onEndCall).toHaveBeenCalledTimes(1);
  });

  it('отображает кнопку смены камеры, если камер больше 1 и видео включено', () => {
    const onSwitchCamera = vi.fn();

    render(
      <ActiveCallView
        activeCall={videoCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={true}
        availableCamerasCount={2}
        callStartedAt={Date.now()}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onSwitchCamera={onSwitchCamera}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    const switchBtn = screen.getByRole('button', { name: 'Переключить камеру' });
    expect(switchBtn).toBeInTheDocument();
    fireEvent.click(switchBtn);
    expect(onSwitchCamera).toHaveBeenCalledTimes(1);
  });

  it('отображает баннер ошибки медиа при ошибке доступа', () => {
    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        mediaError={{
          type: 'NotAllowedError',
          name: 'NotAllowedError',
          message: 'Permission denied',
        }}
        callStartedAt={Date.now()}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText('Доступ к микрофону или камере запрещён')
    ).toBeInTheDocument();
  });

  it('отображает статус соединения при connecting', () => {
    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connecting"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={null}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(screen.getAllByText('Соединение…').length).toBeGreaterThan(0);
  });

  it('не зеркалирует локальное видео PiP при задней камере (facingMode: environment)', () => {
    const fakeStream = new MediaStream();

    render(
      <ActiveCallView
        activeCall={videoCall}
        localStream={fakeStream}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={true}
        facingMode="environment"
        callStartedAt={Date.now()}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    const localVideo = screen.getByLabelText('Ваша камера');
    expect(localVideo).not.toHaveClass('scale-x-[-1]');
  });

  it('отображает индикатор отключённого микрофона собеседника', () => {
    const stream = new MediaStream();
    const mockAudioTrack = {
      kind: 'audio',
      enabled: false,
      muted: true,
      readyState: 'live',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;

    vi.spyOn(stream, 'getAudioTracks').mockReturnValue([mockAudioTrack]);

    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={stream}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(
      screen.getAllByLabelText('Собеседник выключил микрофон').length
    ).toBeGreaterThan(0);
  });

  it('присваивает srcObject удалённому видео после unmute трека', async () => {
    let unmuteHandler: (() => void) | null = null;
    const mockVideoTrack = {
      kind: 'video',
      enabled: true,
      muted: true, // Изначально заглушён
      readyState: 'live',
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'unmute') {
          unmuteHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;

    const stream = new MediaStream();
    vi.spyOn(stream, 'getVideoTracks').mockReturnValue([mockVideoTrack]);

    const { rerender } = render(
      <ActiveCallView
        activeCall={videoCall}
        localStream={null}
        remoteStream={stream}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    // Пока трек muted — видео собеседника скрыто (показывается аватар)
    expect(screen.queryByLabelText('Видео собеседника')).toBeNull();

    // Трек размучивается
    mockVideoTrack.muted = false;
    expect(unmuteHandler).not.toBeNull();
    unmuteHandler!();

    // Ререндерим компонент
    rerender(
      <ActiveCallView
        activeCall={videoCall}
        localStream={null}
        remoteStream={stream}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    const remoteVideo = screen.getByLabelText('Видео собеседника') as HTMLVideoElement;
    expect(remoteVideo).toBeInTheDocument();
    expect(remoteVideo.srcObject).toBe(stream);
  });

  it('рендерит кнопку сверки ключа, если переданы 4 проверочных эмодзи', () => {
    const emojis = ['🐶', '🐱', '🦊', '🐻'];
    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        verificationEmojis={emojis}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    const button = screen.getByRole('button', {
      name: 'Сверка ключа сквозного шифрования',
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('не рендерит кнопку сверки ключа, если эмодзи отсутствуют', () => {
    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        verificationEmojis={null}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(
      screen.queryByRole('button', {
        name: 'Сверка ключа сквозного шифрования',
      })
    ).toBeNull();
  });

  it('открывает поповер сверки ключа при клике, закрывает по крестику и Escape', () => {
    const emojis = ['🐶', '🐱', '🦊', '🐻'];
    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        verificationEmojis={emojis}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    const button = screen.getByRole('button', {
      name: 'Сверка ключа сквозного шифрования',
    });

    // Клик по кнопке открывает поповер
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    const popover = screen.getByRole('note', { name: 'Сверка ключа звонка' });
    expect(popover).toBeInTheDocument();
    expect(screen.getByText('Сверка ключа звонка')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Сравните эти 4 эмодзи с собеседником. Если они совпадают, звонок защищён сквозным шифрованием и никто не может его перехватить.'
      )
    ).toBeInTheDocument();

    // Закрытие по кнопке-крестику
    const closeBtn = screen.getByRole('button', { name: 'Закрыть' });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('note', { name: 'Сверка ключа звонка' })).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');

    // Снова открываем и закрываем по клавише Escape
    fireEvent.click(button);
    expect(screen.getByRole('note', { name: 'Сверка ключа звонка' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('note', { name: 'Сверка ключа звонка' })).toBeNull();
  });

  it('закрывает поповер сверки ключа при клике снаружи', () => {
    const emojis = ['🐶', '🐱', '🦊', '🐻'];
    render(
      <ActiveCallView
        activeCall={audioCall}
        localStream={null}
        remoteStream={null}
        connectionState="connected"
        isAudioEnabled={true}
        isVideoEnabled={false}
        callStartedAt={Date.now()}
        verificationEmojis={emojis}
        onToggleAudio={vi.fn()}
        onToggleVideo={vi.fn()}
        onMinimize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    const button = screen.getByRole('button', {
      name: 'Сверка ключа сквозного шифрования',
    });
    fireEvent.click(button);
    expect(screen.getByRole('note', { name: 'Сверка ключа звонка' })).toBeInTheDocument();

    // Клик снаружи
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('note', { name: 'Сверка ключа звонка' })).toBeNull();
  });
});
