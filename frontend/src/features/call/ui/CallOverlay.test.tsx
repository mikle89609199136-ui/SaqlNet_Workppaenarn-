import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore } from '../model/callStore';
import { CallOverlay } from './CallOverlay';

/* Звонки выключены, пока нет нового экрана разговора (#776 → #774). */

const initial = useCallStore.getState();
const acceptCall = vi.fn();
const rejectCall = vi.fn();
const cancelCall = vi.fn();
const endCall = vi.fn();

const incoming = {
  roomId: 'room-1',
  from: 'user-2',
  fromName: 'Игорь',
  kind: 'audio',
} as unknown as NonNullable<ReturnType<typeof useCallStore.getState>['incomingCall']>;

const outgoing = {
  roomId: 'room-out-1',
  peerId: 'user-3',
  peerName: 'Ольга',
  kind: 'audio',
  phase: 'calling',
} as unknown as NonNullable<ReturnType<typeof useCallStore.getState>['outgoingCall']>;

beforeEach(() => {
  acceptCall.mockReset();
  rejectCall.mockReset();
  cancelCall.mockReset();
  endCall.mockReset();
  useCallStore.setState({ acceptCall, rejectCall, cancelCall, endCall });
});
afterEach(() => useCallStore.setState(initial, true));

describe('звонки выключены', () => {
  it('входящий вызов отклоняется сразу и не показывается: ответить нечем', () => {
    useCallStore.setState({ incomingCall: incoming });
    const { container } = render(<CallOverlay enabled={false} />);
    expect(rejectCall).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('исходящий вызов отменяется сразу при выключении', () => {
    useCallStore.setState({ outgoingCall: outgoing });
    const { container } = render(<CallOverlay enabled={false} />);
    expect(cancelCall).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('звонок, начатый до выключения, завершается', () => {
    useCallStore.setState({
      activeCall: { roomId: 'room-1' } as ReturnType<typeof useCallStore.getState>['activeCall'],
    });
    render(<CallOverlay enabled={false} />);
    expect(endCall).toHaveBeenCalledTimes(1);
  });
});

describe('звонки включены', () => {
  it('карточка входящего: рендерит «Принять», «Отклонить» и вызывает accept/reject', () => {
    useCallStore.setState({ incomingCall: incoming });
    render(<CallOverlay enabled />);

    const acceptBtn = screen.getByRole('button', { name: 'Принять' });
    const rejectBtn = screen.getByRole('button', { name: 'Отклонить' });

    expect(acceptBtn).toBeInTheDocument();
    expect(rejectBtn).toBeInTheDocument();
    expect(screen.getByText('Игорь')).toBeInTheDocument();

    fireEvent.click(acceptBtn);
    expect(acceptCall).toHaveBeenCalledTimes(1);

    fireEvent.click(rejectBtn);
    expect(rejectCall).toHaveBeenCalledTimes(1);
  });

  it('карточка исходящего: рендерит статус Вызов… и кнопку Отменить', () => {
    useCallStore.setState({ outgoingCall: { ...outgoing, phase: 'calling' } });
    render(<CallOverlay enabled />);

    expect(screen.getByText('Ольга')).toBeInTheDocument();
    expect(screen.getByText('Вызов…')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'Отменить' });
    expect(cancelBtn).toBeInTheDocument();

    fireEvent.click(cancelBtn);
    expect(cancelCall).toHaveBeenCalledTimes(1);
  });

  it('карточка исходящего: отображает Звонит… при фазе ringing', () => {
    useCallStore.setState({ outgoingCall: { ...outgoing, phase: 'ringing' } });
    render(<CallOverlay enabled />);

    expect(screen.getByText('Звонит…')).toBeInTheDocument();
  });

  it('карточка исходящего: отображает Занят при фазе busy', () => {
    useCallStore.setState({ outgoingCall: { ...outgoing, phase: 'busy' } });
    render(<CallOverlay enabled />);

    expect(screen.getByText('Занят')).toBeInTheDocument();
  });

  it('карточка исходящего: отображает Отклонён при фазе declined', () => {
    useCallStore.setState({ outgoingCall: { ...outgoing, phase: 'declined' } });
    render(<CallOverlay enabled />);

    expect(screen.getByText('Отклонён')).toBeInTheDocument();
  });

  it('карточка исходящего: отображает Не отвечает при фазе no_answer', () => {
    useCallStore.setState({ outgoingCall: { ...outgoing, phase: 'no_answer' } });
    render(<CallOverlay enabled />);

    expect(screen.getByText('Не отвечает')).toBeInTheDocument();
  });
});
