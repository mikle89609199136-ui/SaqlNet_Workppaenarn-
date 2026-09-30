/**
 * Обновление открытого приложения (#892).
 *
 * Новая сборка сама до открытого приложения не доходит: браузер проверяет
 * service worker только при загрузке страницы, а iPhone держит установленное
 * приложение в памяти днями и страницу при возврате не перезагружает.
 * Здесь — сама механика: узнать, что на сервере другая сборка, и включить
 * её. Когда проверять и когда можно перезагружаться — решает
 * features/app-update.
 *
 * Какая сборка на сервере — в `/version.json` (кладёт сборка, service
 * worker его не перехватывает). Своя — `APP_BUILD` в коде страницы.
 */

export interface IRemoteVersion {
  version: string;
  build: string;
}

/** Результат проверки: есть новая сборка, у нас последняя, или узнать не удалось. */
export type TUpdateCheckResult = 'available' | 'latest' | 'failed';

type TListener = () => void;

interface IWorkerLike {
  state?: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: TListener): void;
}

interface IRegistrationLike {
  waiting: IWorkerLike | null;
  installing: IWorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: 'updatefound', listener: TListener): void;
}

interface IContainerLike {
  controller: unknown;
  getRegistration(scope?: string): Promise<IRegistrationLike | undefined>;
  addEventListener(type: 'controllerchange', listener: TListener): void;
}

export interface IAppUpdateEnv {
  /** Своя сборка — APP_BUILD. */
  build: string;
  /** Service worker; нет — обновление простой перезагрузкой. */
  container: IContainerLike | undefined;
  fetchVersion: () => Promise<IRemoteVersion | null>;
  reload: () => void;
  /** Сколько ждать новый worker после «Обновить», прежде чем перезагрузиться без него. */
  waitingTimeoutMs?: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
}

export const UPDATE_MESSAGE = { type: 'craneapp:update' } as const;
const WAITING_TIMEOUT_MS = 15_000;

function isRemoteVersion(value: unknown): value is IRemoteVersion {
  const candidate = value as Partial<IRemoteVersion> | null;
  return typeof candidate?.version === 'string' && typeof candidate?.build === 'string';
}

/** `/version.json` с сервера, мимо кеша. Нет сети, нет файла (разработка) — null. */
export async function fetchRemoteVersion(): Promise<IRemoteVersion | null> {
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isRemoteVersion(data) ? { version: data.version, build: data.build } : null;
  } catch {
    return null;
  }
}

export function browserAppUpdateEnv(build: string): IAppUpdateEnv {
  const container =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? (navigator.serviceWorker as unknown as IContainerLike)
      : undefined;
  return {
    build,
    container: import.meta.env.PROD ? container : undefined,
    fetchVersion: fetchRemoteVersion,
    reload: () => window.location.reload(),
  };
}

export interface IAppUpdater {
  /** Сверить свою сборку с сервером; новая — подготовить её worker. */
  check(): Promise<{ result: TUpdateCheckResult; remote: IRemoteVersion | null }>;
  /** Включить новую сборку: worker — по сообщению, страница — перезагрузкой. */
  apply(): Promise<void>;
}

export function createAppUpdater(env: IAppUpdateEnv): IAppUpdater {
  const schedule = env.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
  let applying = false;
  let reloaded = false;
  let listening = false;

  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    env.reload();
  };

  const registration = async (): Promise<IRegistrationLike | undefined> => {
    try {
      return await env.container?.getRegistration('/');
    } catch {
      return undefined;
    }
  };

  /* Новый worker включился. Перезагружаемся, только если об этом просили:
     первая установка (clients.claim) и тихое включение той же сборки тоже
     меняют controller, но страница уже та, что нужно. */
  const listen = () => {
    if (listening || !env.container) return;
    listening = true;
    env.container.addEventListener('controllerchange', () => {
      if (applying) reloadOnce();
    });
  };

  /** Дождаться worker, который встанет в ожидание после установки. */
  const whenWaiting = (reg: IRegistrationLike): Promise<IWorkerLike | null> =>
    new Promise((resolve) => {
      if (reg.waiting) {
        resolve(reg.waiting);
        return;
      }
      let done = false;
      const finish = (worker: IWorkerLike | null) => {
        if (done) return;
        done = true;
        resolve(worker);
      };
      const watch = (worker: IWorkerLike | null) =>
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') finish(reg.waiting ?? worker);
          else if (worker.state === 'redundant') finish(null);
        });
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      schedule(() => finish(null), env.waitingTimeoutMs ?? WAITING_TIMEOUT_MS);
    });

  return {
    async check() {
      listen();
      const remote = await env.fetchVersion();
      if (!remote) return { result: 'failed', remote: null };

      const reg = await registration();
      if (remote.build === env.build) {
        /* Страница уже новая (например, после холодного запуска), а
           ожидающий worker остался от прошлой сессии — включить его молча,
           без перезагрузки: иначе он раздавал бы старые файлы. */
        reg?.waiting?.postMessage(UPDATE_MESSAGE);
        return { result: 'latest', remote };
      }

      // Новая сборка: пусть worker скачивает её заранее, к нажатию «Обновить».
      void reg?.update().catch(() => undefined);
      return { result: 'available', remote };
    },

    async apply() {
      listen();
      applying = true;
      const reg = await registration();
      if (!reg || !env.container?.controller) {
        reloadOnce();
        return;
      }
      void reg.update().catch(() => undefined);
      const waiting = await whenWaiting(reg);
      if (!waiting) {
        // Worker не встал (сбой установки, долго качается) — страница
        // всё равно возьмёт новую сборку: навигация идёт в сеть.
        reloadOnce();
        return;
      }
      waiting.postMessage(UPDATE_MESSAGE);
      // Перезагрузка — по controllerchange; не пришёл — сами.
      schedule(reloadOnce, env.waitingTimeoutMs ?? WAITING_TIMEOUT_MS);
    },
  };
}
