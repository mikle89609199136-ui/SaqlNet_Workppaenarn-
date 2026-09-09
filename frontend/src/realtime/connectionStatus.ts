import { WS_EVENTS } from '@/shared/config';
import { eventBus } from '@/core';

/**
 * Состояние связи для интерфейса.
 *
 * Клиент переподключается сам и делает это бесконечно, но пока связи нет,
 * приложение выглядит зависшим: чат открыт, собеседник почему-то молчит, и
 * ни одного объяснения на экране. Здесь хранится то единственное, что нужно
 * сказать человеку.
 *
 * Хранилище намеренно не на React и не в Zustand: подписан на него только
 * тот, кто показывает состояние, а не всё приложение.
 */

export type TConnectionStatus = 'connected' | 'connecting' | 'offline';

/**
 * Через сколько после обрыва жаловаться.
 *
 * Обычное переподключение занимает около секунды. Надпись, мигающая на
 * каждом моргании связи, хуже, чем её отсутствие: она приучает не обращать
 * на себя внимания как раз к тому случаю, ради которого заведена.
 */
export const CONNECTION_NOTICE_DELAY_MS = 2000;

let status: TConnectionStatus = 'connected';
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

// Две беды, независимые друг от друга. Браузер, уходя в офлайн, не закрывает
// уже открытый сокет: он остаётся «открытым» до самого таймаута, хотя
// сообщения через него не ходят. Поэтому сеть и соединение отслеживаются
// порознь, а жалоба показывается, пока есть хоть одна беда.
let networkLost = false;
let connectionLost = false;

const listeners = new Set<() => void>();

function setStatus(next: TConnectionStatus): void {
  if (next === status) return;

  status = next;
  for (const listener of listeners) listener();
}

function cancelNotice(): void {
  if (noticeTimer === null) return;

  clearTimeout(noticeTimer);
  noticeTimer = null;
}

/**
 * Своя сеть отвалилась или сервер не отвечает — это разные беды.
 *
 * Спрашивается сам браузер, а не запомненный флаг: событие о возвращении
 * сети могло и не дойти, а состояние он знает точно.
 */
function troubleStatus(): TConnectionStatus {
  return globalThis.navigator?.onLine === false ? 'offline' : 'connecting';
}

/**
 * Пересмотреть, на что жаловаться.
 *
 * Беда началась — жалоба назначается с задержкой. Беда кончилась — снимается
 * сразу. Беда сменилась другой, пока жалоба уже висит, — меняется только
 * текст: отсчитывать задержку заново значило бы на секунды объявить, что всё
 * хорошо, когда это не так.
 */
function reviewTrouble(): void {
  if (!networkLost && !connectionLost) {
    cancelNotice();
    setStatus('connected');
    return;
  }

  if (status !== 'connected') {
    setStatus(troubleStatus());
    return;
  }

  if (noticeTimer !== null) return;

  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    setStatus(troubleStatus());
  }, CONNECTION_NOTICE_DELAY_MS);
}

function handleConnected(): void {
  connectionLost = false;
  reviewTrouble();
}

function handleDisconnected(): void {
  connectionLost = true;
  reviewTrouble();
}

function handleNetworkChange(): void {
  networkLost = globalThis.navigator?.onLine === false;
  reviewTrouble();
}

/**
 * Следить за связью.
 *
 * Слежение живёт на уровне приложения, а не там, где состояние
 * показывается: обрыв случается и на экране без индикатора, и к моменту
 * возвращения на чат правда о связи должна быть уже известна.
 */
export function startConnectionWatch(): () => void {
  networkLost = globalThis.navigator?.onLine === false;
  connectionLost = false;

  const stopListeningConnected = eventBus.on(WS_EVENTS.SOCKET.CONNECTED, handleConnected);
  const stopListeningDisconnected = eventBus.on(WS_EVENTS.SOCKET.DISCONNECTED, handleDisconnected);

  window.addEventListener('online', handleNetworkChange);
  window.addEventListener('offline', handleNetworkChange);

  return () => {
    stopListeningConnected();
    stopListeningDisconnected();
    window.removeEventListener('online', handleNetworkChange);
    window.removeEventListener('offline', handleNetworkChange);

    // Слежение прекращается вместе с сессией: жаловаться больше не на что.
    networkLost = false;
    connectionLost = false;
    cancelNotice();
    setStatus('connected');
  };
}

export function subscribeToConnectionStatus(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function readConnectionStatus(): TConnectionStatus {
  return status;
}
