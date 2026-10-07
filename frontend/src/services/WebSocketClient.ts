import { eventBus } from '@/shared/lib/event-bus';

/**
 * Потолок паузы между попытками. Дальше растить нечего: полминуты — предел
 * того, сколько человек согласен ждать возвращения связи, не перезагружая
 * страницу.
 */
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Разброс паузы, доля. Нужен, чтобы вкладки не возвращались одной волной. */
const JITTER = 0.2;

/** Что можно переопределить при создании клиента. */
export interface IWebSocketClientOptions {
  /**
   * Вошёл ли человек. Сама сессия — в HttpOnly-cookie (#705): браузер
   * отправит её при подключении сам, в адресе токена нет.
   */
  hasSession?: () => boolean;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

export class WebSocketClient {
  private url: string;
  private hasSession: () => boolean;
  private reconnectDelay: number;
  private maxReconnectDelay: number;
  private socket: WebSocket | null;
  private reconnectAttempts: number;
  private reconnectTimer: number | null;
  private shouldReconnect: boolean;
  private watchingForWakeUps: boolean;
  private handleOnline: () => void;
  private handleVisibilityChange: () => void;

  constructor(url: string, options: IWebSocketClientOptions = {}) {
    this.url = url;
    this.hasSession = options.hasSession ?? (() => false);
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? MAX_RECONNECT_DELAY_MS;
    this.socket = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.shouldReconnect = true;
    this.watchingForWakeUps = false;

    // Обработчики хранятся, иначе их нечем будет снять при выходе из
    // аккаунта — и они пережили бы сам клиент.
    this.handleOnline = () => this.reconnectNow();
    this.handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') this.reconnectNow();
    };
  }

  connect() {
    if (!this.hasSession()) {
      return null;
    }

    this.shouldReconnect = true;
    this.watchForWakeUps();
    this.cancelScheduledReconnect();

    if (
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return this.socket;
    }

    // Каждый обработчик знает, какому соединению он принадлежит, и молчит,
    // если клиент успел переключиться на другое. Иначе события уходящего
    // соединения распоряжаются текущим: закрытие старого обнуляло ссылку
    // на живое новое, и закрыть его после этого было уже некому.
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        // Соединение установилось, когда его уже бросили: без этого оно
        // осталось бы открытым навсегда и продолжало принимать трафик.
        socket.close();
        return;
      }

      this.handleOpen();
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event);
    });

    socket.addEventListener('close', () => this.handleClose(socket));

    socket.addEventListener('error', (event) => {
      if (this.socket !== socket) return;
      eventBus.emit('socket:error', event);
    });

    return socket;
  }

  disconnect() {
    this.shouldReconnect = false;
    this.cancelScheduledReconnect();
    this.stopWatchingForWakeUps();

    // Ссылка обнуляется до закрытия: иначе событие close объявит о разрыве
    // связи, которую разорвали нарочно, и назначит переподключение.
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  send(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    if (typeof payload === 'string') {
      this.socket.send(payload);
    } else {
      this.socket.send(JSON.stringify(payload));
    }
  }

  /** Ответ на сердцебиение. Молча: обрыв здесь важнее любой диагностики. */
  sendPong() {
    try {
      this.send({ type: 'pong' });
    } catch {
      // Соединение уже закрывается — отвечать некому и незачем.
    }
  }

  get isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  handleOpen() {
    this.reconnectAttempts = 0;
    eventBus.emit('socket:connected', undefined);
  }

  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);

      // Сервер держит соединение, пока клиент хоть что-то присылает, и
      // рвёт молчащего через полторы минуты. Своё сердцебиение он шлёт
      // обычным сообщением, а не служебным кадром протокола, поэтому
      // браузер на него не отвечает — приходится отвечать самим. Без
      // этого соединение обрывается каждые полторы минуты у всякого,
      // кто читает, но не пишет.
      if (message.type === 'ping') this.sendPong();

      // Для событий звонков сохраняем контекст отправителя и комнаты
      let eventData = message.payload ?? message;
      if (message.type && typeof message.type === 'string' && message.type.startsWith('call_')) {
        if (message.payload && typeof message.payload === 'object') {
          eventData = {
            ...message.payload,
            from: message.from ?? message.payload.from,
            roomId: message.roomId ?? message.payload.roomId,
          };
        } else {
          eventData = message;
        }
      }

      eventBus.emit(message.type, eventData);
      eventBus.emit('socket:message', message);
    } catch (error) {
      eventBus.emit('socket:message', event.data);
    }
  }

  handleClose(socket = this.socket) {
    // Закрылось не то соединение, которым клиент пользуется сейчас:
    // ни ссылку обнулять, ни переподключаться не нужно.
    if (this.socket !== socket) return;

    this.socket = null;
    eventBus.emit('socket:disconnected', undefined);

    this.scheduleReconnect();
  }

  /**
   * Назначить следующую попытку.
   *
   * Попытки не кончаются. Прежний клиент делал пять штук раз в секунду и
   * после этого молчал до перезагрузки страницы: пятисекундной ямы в метро
   * хватало, чтобы остаться без сообщений до конца сессии — без единого
   * признака в интерфейсе.
   *
   * Пауза удваивается, поэтому недоступный сервер не получает шквал
   * запросов, а вернувшийся отвечает быстро: первая попытка идёт через
   * секунду.
   */
  scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (!this.hasSession()) return;
    // Попытка уже назначена. Второй таймер означал бы два соединения.
    if (this.reconnectTimer !== null) return;

    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.nextReconnectDelay());
  }

  nextReconnectDelay() {
    const backoff = Math.min(
      this.reconnectDelay * 2 ** (this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    // Разброс: после перезапуска сервера все вкладки всех пользователей
    // отсчитывают одну и ту же паузу от одного и того же мгновения.
    return Math.round(backoff * (1 - JITTER + Math.random() * JITTER * 2));
  }

  cancelScheduledReconnect() {
    if (this.reconnectTimer === null) return;

    window.clearTimeout?.(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /**
   * Связь появилась — пробовать сейчас, а не досиживать паузу.
   *
   * К этому моменту пауза могла вырасти до получаса ожидания на двоих:
   * человек видит, что сеть вернулась, а приложение — ещё нет.
   */
  reconnectNow() {
    if (!this.shouldReconnect || this.isConnected || !this.hasSession()) return;

    // Соединение могло зависнуть в попытке подключиться ещё тогда, когда
    // сети не было: мёртвым браузер признает его нескоро. Начинаем начисто.
    const stale = this.socket;
    this.socket = null;
    stale?.close();

    this.cancelScheduledReconnect();
    this.reconnectAttempts = 0;
    this.connect();
  }

  /** Возвращение сети и возвращение к вкладке — поводы попробовать снова. */
  watchForWakeUps() {
    if (this.watchingForWakeUps) return;
    this.watchingForWakeUps = true;

    window.addEventListener?.('online', this.handleOnline);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  stopWatchingForWakeUps() {
    if (!this.watchingForWakeUps) return;
    this.watchingForWakeUps = false;

    window.removeEventListener?.('online', this.handleOnline);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }
}
