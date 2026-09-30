import { create } from 'zustand';
import { hasAnyDraft } from '@/entities/chat';
import { useOutboxStore } from '@/entities/message';
import { APP_BUILD } from '@/shared/config';
import {
  appUpdateHolds,
  browserAppUpdateEnv,
  createAppUpdater,
  subscribeAppUpdateHolds,
  type IAppUpdater,
  type IRemoteVersion,
  type TUpdateCheckResult,
  type TUpdateHoldReason,
} from '@/shared/lib';

/*
 * Обновление приложения без переустановки (#892).
 *
 * Открытое приложение само сверяет свою сборку с сервером; новая — плашка
 * «Доступна новая версия» и строка в «О приложении». «Обновить» не рвёт то,
 * что идёт: ждёт отправки сообщений, конца звонка и записи голосового.
 */

/** Чего ждёт «Обновить»: отправки, звонка или записи. */
export type TUpdateWait = 'sending' | TUpdateHoldReason;

interface IAppUpdateState {
  /** Новая сборка на сервере; null — у нас последняя (или ещё не знаем). */
  remote: IRemoteVersion | null;
  /** Плашку закрыли для этой сборки — до следующей. */
  dismissedBuild: string | null;
  checking: boolean;
  /** Итог последней проверки — для «О приложении». */
  lastCheck: TUpdateCheckResult | null;
  /** Нажали «Обновить»: ждём повода или уже обновляемся. */
  requested: boolean;
  waitingFor: TUpdateWait | null;
}

export const useAppUpdateStore = create<IAppUpdateState>(() => ({
  remote: null,
  dismissedBuild: null,
  checking: false,
  lastCheck: null,
  requested: false,
  waitingFor: null,
}));

/** Всё, что нужно снаружи, — подменяется в тестах. */
export interface IAppUpdateDeps {
  updater: IAppUpdater;
  holds: () => TUpdateHoldReason[];
  subscribeHolds: (listener: () => void) => () => void;
  /** Отправляется ли что-то прямо сейчас. */
  sending: () => boolean;
  subscribeSending: (listener: () => void) => () => void;
  /** Пропадёт ли что-то при перезагрузке: черновики, неотправленное. */
  unsaved: () => boolean;
  now: () => number;
}

const isSending = () =>
  useOutboxStore
    .getState()
    .items.some((item) => item.status === 'pending' || item.status === 'uploading');

let browserDeps: IAppUpdateDeps | null = null;

export function appUpdateDeps(): IAppUpdateDeps {
  browserDeps ??= {
    updater: createAppUpdater(browserAppUpdateEnv(APP_BUILD)),
    holds: appUpdateHolds,
    subscribeHolds: subscribeAppUpdateHolds,
    sending: isSending,
    subscribeSending: (listener) => useOutboxStore.subscribe(listener),
    unsaved: () =>
      hasAnyDraft() || useOutboxStore.getState().items.some((item) => item.status === 'failed'),
    now: () => Date.now(),
  };
  return browserDeps;
}

/** Сами проверяем не чаще: возврат в приложение, сокет и таймер сходятся. */
export const AUTO_CHECK_MIN_INTERVAL_MS = 60_000;
let lastAutoCheckAt = -Infinity;

/**
 * Сверить сборку с сервером. `manual` — кнопка «Проверить»: без
 * ограничения частоты и с итогом для экрана.
 */
export async function checkForUpdate(
  { manual = false }: { manual?: boolean } = {},
  deps: IAppUpdateDeps = appUpdateDeps()
): Promise<TUpdateCheckResult | null> {
  if (!manual) {
    if (deps.now() - lastAutoCheckAt < AUTO_CHECK_MIN_INTERVAL_MS) return null;
    lastAutoCheckAt = deps.now();
  }
  if (manual) useAppUpdateStore.setState({ checking: true });
  const { result, remote } = await deps.updater.check();
  useAppUpdateStore.setState((state) => ({
    checking: false,
    lastCheck: manual || result !== 'failed' ? result : state.lastCheck,
    // Сбой проверки не отменяет уже найденную новую сборку.
    remote: result === 'available' ? remote : result === 'latest' ? null : state.remote,
  }));
  return result;
}

/** Чего ждать, прежде чем перезагрузиться; null — можно сейчас. */
function currentWait(deps: IAppUpdateDeps): TUpdateWait | null {
  if (deps.sending()) return 'sending';
  return deps.holds()[0] ?? null;
}

/** Пропадёт ли что-то при обновлении — тогда сначала спросить. */
export function updateLosesUnsavedWork(deps: IAppUpdateDeps = appUpdateDeps()): boolean {
  return deps.unsaved();
}

/**
 * «Обновить». Идёт отправка, звонок или запись — ждём и обновляемся сами,
 * как только всё закончится.
 */
export function requestUpdate(deps: IAppUpdateDeps = appUpdateDeps()): void {
  if (useAppUpdateStore.getState().requested) return;
  useAppUpdateStore.setState({ requested: true });

  let stop = () => {};
  const attempt = () => {
    const wait = currentWait(deps);
    useAppUpdateStore.setState({ waitingFor: wait });
    if (wait) return;
    stop();
    void deps.updater.apply();
  };
  const unsubscribeHolds = deps.subscribeHolds(attempt);
  const unsubscribeSending = deps.subscribeSending(attempt);
  stop = () => {
    unsubscribeHolds();
    unsubscribeSending();
  };
  attempt();
}

export function dismissUpdate(): void {
  const { remote } = useAppUpdateStore.getState();
  useAppUpdateStore.setState({ dismissedBuild: remote?.build ?? null });
}

/** Для тестов: начать с чистого листа. */
export function resetAppUpdate(): void {
  lastAutoCheckAt = -Infinity;
  useAppUpdateStore.setState({
    remote: null,
    dismissedBuild: null,
    checking: false,
    lastCheck: null,
    requested: false,
    waitingFor: null,
  });
}
