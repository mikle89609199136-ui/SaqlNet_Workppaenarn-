import { CONNECTION_NOTICE_DELAY_MS, startConnectionWatch } from '@/realtime/connectionStatus';
import { WebSocketClient } from '@/services/WebSocketClient';
import { WS_EVENTS } from '@/shared/config';
import { eventBus } from '@/shared/lib/event-bus';
import { testI18n } from '@/test/harness/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionBanner } from './ConnectionBanner';

let stopWatch: (() => void) | null = null;
// Свои подмены — и возвращаем только их: restoreAllMocks сбросил бы и
// общие заглушки соседних файлов (тесты идут без изоляции).
const spies: Array<{ mockRestore: () => void }> = [];

function loseConnection(online: boolean) {
  spies.push(vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online));
  act(() => {
    eventBus.emit(WS_EVENTS.SOCKET.DISCONNECTED as never, {} as never);
    vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
  });
}

function renderBanner() {
  return render(
    <I18nextProvider i18n={testI18n}>
      <ConnectionBanner />
    </I18nextProvider>
  );
}

/* Плашка связи под шапкой чата (#826). */
describe('ConnectionBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopWatch = startConnectionWatch();
  });

  afterEach(() => {
    // Связь — общее состояние на все тесты: возвращаем как было.
    act(() => eventBus.emit(WS_EVENTS.SOCKET.CONNECTED as never, {} as never));
    stopWatch?.();
    stopWatch = null;
    spies.splice(0).forEach((spy) => spy.mockRestore());
    vi.useRealTimers();
  });

  it('связь есть — плашки нет', () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('нет сети — предупреждение и «Повторить», которое переподключает сейчас', () => {
    const reconnect = vi
      .spyOn(WebSocketClient.prototype, 'reconnectNow')
      .mockImplementation(() => {});
    spies.push(reconnect);
    renderBanner();

    loseConnection(false);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Нет связи. Сообщения уйдут, когда появится сеть.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(reconnect).toHaveBeenCalled();
  });

  it('сеть есть, сервер не отвечает — «Подключаемся…» без кнопки', () => {
    renderBanner();

    loseConnection(true);

    expect(screen.getByRole('status')).toHaveTextContent('Подключаемся…');
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
  });
});
