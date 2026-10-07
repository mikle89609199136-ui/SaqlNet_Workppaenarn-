import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IRemoteVersion, TUpdateCheckResult, TUpdateHoldReason } from '@/shared/lib';
import {
  AUTO_CHECK_MIN_INTERVAL_MS,
  checkForUpdate,
  dismissUpdate,
  requestUpdate,
  resetAppUpdate,
  useAppUpdateStore,
  type IAppUpdateDeps,
} from './appUpdate';

/* Когда показывать новую версию и когда можно перезагружаться (#892). */

const NEW: IRemoteVersion = { version: '0.10.0', build: 'new' };

function makeDeps(result: TUpdateCheckResult = 'available') {
  let now = 0;
  let sending = false;
  let holds: TUpdateHoldReason[] = [];
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const deps: IAppUpdateDeps = {
    updater: {
      check: vi.fn(async () => ({ result, remote: result === 'failed' ? null : NEW })),
      apply: vi.fn(async () => undefined),
    },
    holds: () => holds,
    subscribeHolds: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sending: () => sending,
    subscribeSending: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    unsaved: () => false,
    now: () => now,
  };
  return {
    deps,
    advance: (ms: number) => (now += ms),
    setSending: (value: boolean) => ((sending = value), changed()),
    setHolds: (value: TUpdateHoldReason[]) => ((holds = value), changed()),
    listeners,
  };
}

beforeEach(() => resetAppUpdate());

describe('проверка', () => {
  it('новая сборка на сервере — она в состоянии; «последняя» — убирает её', async () => {
    const available = makeDeps('available');
    await checkForUpdate({ manual: true }, available.deps);
    expect(useAppUpdateStore.getState().remote).toEqual(NEW);
    expect(useAppUpdateStore.getState().lastCheck).toBe('available');

    await checkForUpdate({ manual: true }, makeDeps('latest').deps);
    expect(useAppUpdateStore.getState().remote).toBeNull();
    expect(useAppUpdateStore.getState().lastCheck).toBe('latest');
  });

  it('сбой проверки не прячет уже найденную новую сборку', async () => {
    await checkForUpdate({ manual: true }, makeDeps('available').deps);
    await checkForUpdate({ manual: true }, makeDeps('failed').deps);
    expect(useAppUpdateStore.getState().remote).toEqual(NEW);
    expect(useAppUpdateStore.getState().lastCheck).toBe('failed');
  });

  it('сами — не чаще раза в минуту; кнопка «Проверить» — всегда', async () => {
    const { deps, advance } = makeDeps();
    await checkForUpdate({}, deps);
    await checkForUpdate({}, deps);
    expect(deps.updater.check).toHaveBeenCalledTimes(1);

    await checkForUpdate({ manual: true }, deps);
    expect(deps.updater.check).toHaveBeenCalledTimes(2);

    advance(AUTO_CHECK_MIN_INTERVAL_MS);
    await checkForUpdate({}, deps);
    expect(deps.updater.check).toHaveBeenCalledTimes(3);
  });

  it('автоматический сбой не пишет «не удалось» в настройки', async () => {
    await checkForUpdate({}, makeDeps('failed').deps);
    expect(useAppUpdateStore.getState().lastCheck).toBeNull();
  });
});

describe('«Обновить»', () => {
  it('ничего не мешает — сразу', () => {
    const { deps } = makeDeps();
    requestUpdate(deps);
    expect(deps.updater.apply).toHaveBeenCalledTimes(1);
    expect(useAppUpdateStore.getState()).toMatchObject({ requested: true, waitingFor: null });
  });

  it('идёт отправка — ждёт её конца, потом обновляется сам', () => {
    const { deps, setSending, listeners } = makeDeps();
    setSending(true);
    requestUpdate(deps);
    expect(deps.updater.apply).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().waitingFor).toBe('sending');

    setSending(false);
    expect(deps.updater.apply).toHaveBeenCalledTimes(1);
    // Подписки сняты: дальнейшие изменения обновление не повторяют.
    expect(listeners.size).toBe(0);
  });

  it('звонок, потом запись — ждёт оба повода', () => {
    const { deps, setHolds } = makeDeps();
    setHolds(['call']);
    requestUpdate(deps);
    expect(useAppUpdateStore.getState().waitingFor).toBe('call');

    setHolds(['recording']);
    expect(useAppUpdateStore.getState().waitingFor).toBe('recording');
    expect(deps.updater.apply).not.toHaveBeenCalled();

    setHolds([]);
    expect(deps.updater.apply).toHaveBeenCalledTimes(1);
  });

  it('повторное нажатие ничего не добавляет', () => {
    const { deps, setSending } = makeDeps();
    setSending(true);
    requestUpdate(deps);
    requestUpdate(deps);
    setSending(false);
    expect(deps.updater.apply).toHaveBeenCalledTimes(1);
  });
});

it('«Не сейчас» прячет плашку этой сборки', async () => {
  await checkForUpdate({ manual: true }, makeDeps().deps);
  dismissUpdate();
  expect(useAppUpdateStore.getState().dismissedBuild).toBe('new');
});
