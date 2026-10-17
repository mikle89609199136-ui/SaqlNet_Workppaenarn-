import { eventBus } from '@/shared/lib/event-bus';

/**
 * Потолок паузы между попытками. Дальше растить нечего: полминуты — предел
 * того, сколько человек согласен ждать возвращения связи, не перезагружая
 * страницу.
 */
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Разброс паузы, доля. Нужен, чтобы вкладки не возвращались одной волной. */
const JITTER = 0.2;

/**
 * Сколько тишины считать обрывом (#1069). Сервер шлёт ping раз в 30 с, но
 * перед каждым проверяет отзыв токена и продлевает присутствие — на живом
 * соединении пауза доходит до ~43 с. Два интервала с запасом и меньше
 * серверных 90 с, после которых он рвёт молчащего сам.
 */
const LIVENESS_TIMEOUT_MS = 60_000;

/**
 * Сколько ждать ответа на свой ping при пробуждении: с запасом на проверку
 * отзыва, которую сервер делает перед ответом (до 3 с).
 */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * На какой неудаче подряд спрашивать сервер, жива ли сессия (#1070).
 * Первая проверка — примерно через 3 с после обрыва (паузы 1 + 2 с):
 * короткое моргание сети её не вызывает. Дальше — каждые три попытки.
 */
const SESSION_CHECK_EVERY = 3;

/** Что можно переопределить при создании клиента. */
export interface IWebSocketClientOptions {
  /**
   * Вошёл ли человек. Сама сессия — в HttpOnly-cookie (#705): браузер
   * отправит её при подключении сам, в адресе токена нет.
   */
  hasSession?: () => boolean;
  /**
   * Жива ли сессия на сервере: `false` — её нет, `true` — есть или
   * проверить не удалось. Транспорт о HTTP не знает, проверку дают ему.
   */
  checkSession?: () => Promise<boolean>;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  /** Тишина, после которой соединение считается мёртвым. */
  livenessTimeout?: number;
  /** Ожидание ответа на ping при проверке открытого соединения. */
  probeTimeout?: number;
}

export class WebSocketClient {
  private url: string;
  private hasSession: () => boolean;
  private checkSession?: () => Promise<boolean>;
  private checkingSession: boolean;
  private reconnectDelay: number;
  private maxReconnectDelay: number;
  private livenessTimeout: number;
  private probeTimeout: number;
  private livenessTimer: number | null;
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
    this.checkSession = options.checkSession;
    this.checkingSession = false;
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? MAX_RECONNECT_DELAY_MS;
    this.livenessTimeout = options.livenessTimeout ?? LIVENESS_TIMEOUT_MS;
    this.probeTimeout = options.probeTimeout ?? PROBE_TIMEOUT_MS;
    this.livenessTimer = null;
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
    this.stopLivenessTimer();
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
    this.armLivenessTimer(this.livenessTimeout);
    eventBus.emit('socket:connected', undefined);
  }

  handleMessage(event) {
    // Любое входящее — признак жизни: и ping, и pong, и событие.
    this.armLivenessTimer(this.livenessTimeout);

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
            from: message.from,
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
    this.stopLivenessTimer();
    eventBus.emit('socket:disconnected', undefined);

    this.scheduleReconnect();
  }

  /**
   * Сторожевой таймер соединения (#1069).
   *
   * Соединение рвётся и молча: ноутбук проснулся, телефон сменил сеть,
   * роутер сбросил NAT. Браузер признаёт такое мёртвым нескоро — `close`
   * может не прийти минутами, а клиент сам в него не пишет, пока не
   * спросят. Всё это время шапка показывала «на связи», а сообщения не
   * приходили. Таймер заводится на открытие и на каждое входящее и
   * снимается на закрытие; без соединения не заводится.
   */
  armLivenessTimer(timeout: number) {
    this.stopLivenessTimer();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    this.livenessTimer = window.setTimeout(() => {
      this.livenessTimer = null;
      this.dropDeadConnection(socket);
    }, timeout);
  }

  stopLivenessTimer() {
    if (this.livenessTimer === null) return;

    window.clearTimeout?.(this.livenessTimer);
    this.livenessTimer = null;
  }

  /** Соединение молчит — бросить его и сразу подключиться заново. */
  dropDeadConnection(socket: WebSocket) {
    if (this.socket !== socket) return;

    // Отвязываем до закрытия: `close`, который придёт когда-нибудь потом,
    // не тронет новое соединение и не объявит обрыв второй раз.
    this.socket = null;
    socket.close();
    eventBus.emit('socket:disconnected', undefined);

    if (!this.shouldReconnect || !this.hasSession()) return;
    // Новая попытка — сразу. Не удастся — дальше обычная пауза.
    this.connect();
  }

  /**
   * Проверить открытое соединение: ping и короткое ожидание. Ответ (или
   * любое входящее) вернёт обычный таймер, тишина — оборвёт.
   */
  probeConnection() {
    try {
      this.send({ type: 'ping' });
    } catch {
      return;
    }
    this.armLivenessTimer(this.probeTimeout);
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

    if (this.reconnectAttempts % SESSION_CHECK_EVERY === 0) this.verifySession();
  }

  /**
   * Сессию отозвали — переподключаться бессмысленно (#1070).
   *
   * Завершённые с другого устройства сеансы сервер закрывает и на новое
   * рукопожатие отвечает 401, но браузер код не показывает: вкладка без
   * действий человека бесконечно висела на «Подключаемся…». Проверка
   * идёт по HTTP: на 401 клиент API сам уведёт на вход, здесь лишь
   * перестаём пробовать.
   */
  verifySession() {
    if (!this.checkSession || this.checkingSession) return;

    this.checkingSession = true;
    this.checkSession()
      .then((alive) => {
        if (!alive) this.disconnect();
      })
      .catch(() => {
        // Проверка не удалась — пробуем дальше, как раньше.
      })
      .finally(() => {
        this.checkingSession = false;
      });
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
    if (!this.shouldReconnect || !this.hasSession()) return;
    // Открытое ещё не значит живое (#1069): после сна и смены сети
    // соединение может висеть полуоткрытым. Проверяем его, а не выходим.
    if (this.isConnected) {
      this.probeConnection();
      return;
    }

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
