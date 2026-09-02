import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { disconnectRealtimeSocket, useRealtimeSocket } from './useRealtimeSocket';

describe('общее соединение', () => {
  it('should hand out the same client to every consumer', () => {
    const first = renderHook(() => useRealtimeSocket(false));
    const second = renderHook(() => useRealtimeSocket(false));

    expect(second.result.current.socket).toBe(first.result.current.socket);
  });

  it('should hand out a new client after the session ended', () => {
    // Компоненты выше роутера не размонтируются при выходе из аккаунта.
    // Пока клиент запоминался при первом рендере, они продолжали держать
    // прежний, и повторный вход поднимал второе соединение поверх него —
    // каждое событие приходило дважды.
    const { result, rerender } = renderHook(() => useRealtimeSocket(false));
    const previous = result.current.socket;

    disconnectRealtimeSocket();
    rerender();

    expect(result.current.socket).not.toBe(previous);
  });
});
