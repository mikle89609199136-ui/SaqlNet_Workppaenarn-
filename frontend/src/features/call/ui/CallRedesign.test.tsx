import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCallStage } from '../model/callStage';
import { useCallStore } from '../model/callStore';
import type { IActiveCall, IIncomingCall, IOutgoingCall } from '../model/types';
import { ActiveCallView, type IActiveCallViewProps } from './ActiveCallView';
import { CallOverlay } from './CallOverlay';
import { MinimizedCallBar } from './MinimizedCallBar';

const initialState = useCallStore.getState();
const acceptCall = vi.fn();
const cancelCall = vi.fn();

const videoIncoming: IIncomingCall = {
  roomId: 'room-1',
  from: 'user-2',
  fromName: 'Вася',
  kind: 'video',
};

const activeCall: IActiveCall = {
  roomId: 'room-1',
  type: 'p2p',
  kind: 'audio',
  peerId: 'user-2',
  peerName: 'Вася',
};

function emulatePhone(isPhone: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: isPhone && query.includes('max-width'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList
  );
}

function cameraStream(hasVideo: boolean) {
  return { getVideoTracks: () => (hasVideo ? [{}] : []) } as unknown as MediaStream;
}

function viewProps(overrides: Partial<IActiveCallViewProps> = {}): IActiveCallViewProps {
  return {
    activeCall,
    localStream: null,
    remoteStream: null,
    connectionState: 'connected',
    isAudioEnabled: true,
    isVideoEnabled: false,
    callStartedAt: Date.now(),
    onToggleAudio: vi.fn(),
    onToggleVideo: vi.fn(),
    onMinimize: vi.fn(),
    onEndCall: vi.fn(),
    ...overrides,
  };
}

let stage: HTMLElement;

beforeEach(() => {
  acceptCall.mockReset();
  cancelCall.mockReset();
  useCallStore.setState({ acceptCall, cancelCall });
  stage = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
  act(() => setCallStage(null));
  stage.remove();
  vi.restoreAllMocks();
  useCallStore.setState(initialState, true);
});

describe('входящий вызов (#954)', () => {
  it('на ПК — компактная карточка в колонке переписки', () => {
    emulatePhone(false);
    act(() => setCallStage(stage));
    useCallStore.setState({ incomingCall: videoIncoming });

    render(<CallOverlay enabled />);

    const card = screen.getByRole('alertdialog', { name: 'Входящий видеозвонок' });
    expect(stage).toContainElement(card);
    expect(card).toHaveAttribute('data-surface', 'stage');
    expect(card).toHaveClass('w-[404px]');
  });

  it('на телефоне — во весь экран, с подписями под кнопками', () => {
    emulatePhone(true);
    act(() => setCallStage(stage));
    useCallStore.setState({ incomingCall: videoIncoming });

    render(<CallOverlay enabled />);

    const fullScreen = screen.getByRole('alertdialog', { name: 'Входящий видеозвонок' });
    expect(stage).not.toContainElement(fullScreen);
    expect(fullScreen).toHaveAttribute('data-surface', 'screen');
    expect(fullScreen).toHaveTextContent('Без видео');
  });

  it('«Ответить без видео» принимает видеовызов с выключенной камерой', () => {
    emulatePhone(false);
    useCallStore.setState({ incomingCall: videoIncoming });
    render(<CallOverlay enabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Ответить без видео' }));

    expect(acceptCall).toHaveBeenCalledWith({ video: false });
  });

  it('у аудиовызова ответа без видео нет', () => {
    emulatePhone(false);
    useCallStore.setState({ incomingCall: { ...videoIncoming, kind: 'audio' } });
    render(<CallOverlay enabled />);

    expect(screen.queryByRole('button', { name: 'Ответить без видео' })).not.toBeInTheDocument();
  });
});

describe('исходящий вызов (#954)', () => {
  it('видеовызов показывает свой статус, «Отменить» отменяет', () => {
    emulatePhone(false);
    const outgoingCall: IOutgoingCall = {
      roomId: 'room-2',
      peerId: 'user-3',
      peerName: 'Ольга',
      kind: 'video',
      phase: 'calling',
    };
    useCallStore.setState({ outgoingCall });
    render(<CallOverlay enabled />);

    expect(screen.getByText('Видеовызов…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(cancelCall).toHaveBeenCalledTimes(1);
  });
});

describe('экран разговора (#954)', () => {
  it('под кнопками Dock — подписи', () => {
    emulatePhone(false);
    render(<ActiveCallView {...viewProps({ activeCall: { ...activeCall, kind: 'video' } })} />);

    const dock = screen.getByRole('button', { name: 'Завершить' }).closest('footer');
    expect(dock).toHaveTextContent('Микрофон');
    expect(dock).toHaveTextContent('Камера');
    expect(dock).toHaveTextContent('Завершить');
  });

  it('выключенный микрофон — плашка над Dock', () => {
    emulatePhone(false);
    render(<ActiveCallView {...viewProps({ isAudioEnabled: false })} />);

    expect(screen.getByText('Ваш микрофон выключен')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Включить микрофон' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('своя камера — в PiP по сетке макета, с подписью «Вы»', () => {
    emulatePhone(false);
    render(
      <ActiveCallView
        {...viewProps({
          activeCall: { ...activeCall, kind: 'video' },
          isVideoEnabled: true,
          localStream: cameraStream(true),
        })}
      />
    );

    const pip = screen.getByLabelText('Ваша камера').parentElement;
    expect(pip).toHaveClass('w-27', 'h-37.5', 'md:w-55', 'md:h-35', 'rounded-[16px]');
    expect(pip).toHaveTextContent('Вы');
  });

  it('в аудиозвонке нет ни окна «Вы», ни кнопки камеры', () => {
    emulatePhone(false);
    render(
      <ActiveCallView {...viewProps({ isVideoEnabled: true, localStream: cameraStream(false) })} />
    );

    expect(screen.queryByLabelText('Ваша камера')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /камеру/ })).not.toBeInTheDocument();
  });

  it('видеозвонок без видеодорожки — камера показана выключенной', () => {
    emulatePhone(false);
    render(
      <ActiveCallView
        {...viewProps({
          activeCall: { ...activeCall, kind: 'video' },
          isVideoEnabled: true,
          localStream: cameraStream(false),
        })}
      />
    );

    expect(screen.queryByLabelText('Ваша камера')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Включить камеру' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('«Свернуть звонок» сворачивает', () => {
    emulatePhone(false);
    const onMinimize = vi.fn();
    render(<ActiveCallView {...viewProps({ onMinimize })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть звонок' }));

    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it('на ПК разговор идёт в колонке переписки, а не поверх всего окна', () => {
    emulatePhone(false);
    act(() => setCallStage(stage));

    render(<ActiveCallView {...viewProps()} />);

    expect(stage).toContainElement(screen.getByRole('dialog', { name: 'Активный звонок' }));
  });
});

describe('свёрнутый звонок (#954)', () => {
  it('на ПК — полоса 44px под шапкой чата с кнопками 32px', () => {
    emulatePhone(false);
    act(() => setCallStage(stage));

    render(
      <MinimizedCallBar
        activeCall={activeCall}
        callStartedAt={Date.now()}
        connectionState="connected"
        isAudioEnabled
        isVideoEnabled={false}
        onEndCall={vi.fn()}
        onMaximize={vi.fn()}
        onToggleAudio={vi.fn()}
      />
    );

    const bar = screen.getByRole('region', { name: 'Свёрнутый звонок' });
    expect(stage).toContainElement(bar);
    expect(bar).toHaveClass('h-11', 'top-16', 'bg-brand-fill');
    expect(screen.getByRole('button', { name: 'Завершить' })).toHaveClass('size-8');
    expect(bar).toHaveTextContent('Вернуться');
  });
});
