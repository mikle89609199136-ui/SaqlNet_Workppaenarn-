import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore } from '../model/callStore';
import { CallOverlay } from './CallOverlay';

/* Звонки выключены, пока нет нового экрана разговора (#776 → #774). */

const initial = useCallStore.getState();
const rejectCall = vi.fn();
const endCall = vi.fn();

const incoming = {
  roomId: 'room-1',
  from: 'user-2',
  fromName: 'Игорь',
  kind: 'audio',
} as unknown as NonNullable<ReturnType<typeof useCallStore.getState>['incomingCall']>;

beforeEach(() => {
  rejectCall.mockReset();
  endCall.mockReset();
  useCallStore.setState({ rejectCall, endCall });
});
afterEach(() => useCallStore.setState(initial, true));

describe('звонки выключены', () => {
  it('входящий вызов отклоняется сразу и не показывается: ответить нечем', () => {
    useCallStore.setState({ incomingCall: incoming });
    const { container } = render(<CallOverlay enabled={false} />);
    expect(rejectCall).toHaveBeenCalledTimes(1);
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

it('звонки включены — карточка входящего с «Принять» и «Отклонить»', () => {
  useCallStore.setState({ incomingCall: incoming });
  render(<CallOverlay enabled />);
  expect(screen.getByRole('button', { name: 'Принять' })).toBeInTheDocument();
  expect(rejectCall).not.toHaveBeenCalled();
});
