import { WebSocketClient } from '@/services/WebSocketClient';

/**
 * Доставка серверных событий в тестах.
 *
 * Событие проходит через настоящий `WebSocketClient.handleMessage`, а не
 * публикуется в шину напрямую. Разница существенна: разбор сообщения,
 * выбор поля payload и имя события определяются продакшн-кодом. Если он
 * изменится, тесты пойдут новым путём вместе с приложением.
 */
const client = new WebSocketClient('ws://localhost/ws');

export const fakeSocket = {
  /** Присылает событие так, как его прислал бы сервер. */
  emit(type: string, payload: unknown = {}): void {
    client.handleMessage({ data: JSON.stringify({ type, payload }) } as MessageEvent);
  },

  /** Присылает сообщение без обёртки payload — сервер умеет и так. */
  emitFlat(message: Record<string, unknown>): void {
    client.handleMessage({ data: JSON.stringify(message) } as MessageEvent);
  },

  /** Присылает то, что не разбирается как JSON. */
  emitRaw(data: string): void {
    client.handleMessage({ data } as MessageEvent);
  },
};
