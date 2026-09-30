import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MinimizedCallBar } from './MinimizedCallBar';
import type { IActiveCall } from '../model/types';

describe('MinimizedCallBar', () => {
  const activeCall: IActiveCall = {
    roomId: 'room-min-1',
    type: 'p2p',
    kind: 'audio',
    peerId: 'peer-3',
    peerName: 'Мария',
  };

  it('рендерит имя собеседника и элементы управления', () => {
    const onMaximize = vi.fn();
    const onEndCall = vi.fn();

    render(
      <MinimizedCallBar
        activeCall={activeCall}
        connectionState="connected"
        callStartedAt={Date.now() - 10000}
        isAudioEnabled={true}
        isVideoEnabled={false}
        onMaximize={onMaximize}
        onEndCall={onEndCall}
      />
    );

    expect(screen.getByText('Мария')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Развернуть звонок' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
  });

  it('вызывает onMaximize при клике по плашке', () => {
    const onMaximize = vi.fn();

    render(
      <MinimizedCallBar
        activeCall={activeCall}
        connectionState="connected"
        callStartedAt={Date.now()}
        isAudioEnabled={true}
        isVideoEnabled={false}
        onMaximize={onMaximize}
        onEndCall={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть звонок' })[0]);
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it('вызывает onEndCall при клике по кнопке завершения', () => {
    const onEndCall = vi.fn();

    render(
      <MinimizedCallBar
        activeCall={activeCall}
        connectionState="connected"
        callStartedAt={Date.now()}
        isAudioEnabled={true}
        isVideoEnabled={false}
        onMaximize={vi.fn()}
        onEndCall={onEndCall}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    expect(onEndCall).toHaveBeenCalledTimes(1);
  });

  it('показывает индикатор выключенного микрофона, если isAudioEnabled === false', () => {
    render(
      <MinimizedCallBar
        activeCall={activeCall}
        connectionState="connected"
        callStartedAt={Date.now()}
        isAudioEnabled={false}
        isVideoEnabled={false}
        onMaximize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Микрофон выключен')).toBeInTheDocument();
  });

  it('показывает индикатор выключенной камеры в видеозвонке, если isVideoEnabled === false', () => {
    const videoCall: IActiveCall = {
      ...activeCall,
      kind: 'video',
    };

    render(
      <MinimizedCallBar
        activeCall={videoCall}
        connectionState="connected"
        callStartedAt={Date.now()}
        isAudioEnabled={true}
        isVideoEnabled={false}
        onMaximize={vi.fn()}
        onEndCall={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Камера выключена')).toBeInTheDocument();
  });
});
