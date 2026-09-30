import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActiveCallView } from './ActiveCallView';
import type { IActiveCall } from '../model/types';

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
});
