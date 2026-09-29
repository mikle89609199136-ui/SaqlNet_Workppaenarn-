import { describe, expect, it, vi } from 'vitest';
import {
  createAppUpdater,
  UPDATE_MESSAGE,
  type IAppUpdateEnv,
  type IRemoteVersion,
} from './appUpdate';

/*
 * Обновление открытого приложения (#892): поддельные service worker и
 * /version.json — как их видит страница.
 */

class FakeWorker {
  state = 'installing';
  postMessage = vi.fn();
  private listeners: Array<() => void> = [];
  addEventListener(_type: 'statechange', listener: () => void) {
    this.listeners.push(listener);
  }
  become(state: string) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

class FakeRegistration {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(async () => undefined);
  private listeners: Array<() => void> = [];
  addEventListener(_type: 'updatefound', listener: () => void) {
    this.listeners.push(listener);
  }
  /** Браузер нашёл новый sw.js и начал его ставить. */
  found() {
    this.installing = new FakeWorker();
    this.listeners.forEach((listener) => listener());
    return this.installing;
  }
  /** Установка закончилась: worker ждёт. */
  installed(worker: FakeWorker) {
    this.installing = null;
    this.waiting = worker;
    worker.become('installed');
  }
}

class FakeContainer {
  controller: unknown = {};
  registration: FakeRegistration | undefined = new FakeRegistration();
  private listeners: Array<() => void> = [];
  getRegistration = vi.fn(async () => this.registration);
  addEventListener(_type: 'controllerchange', listener: () => void) {
    this.listeners.push(listener);
  }
  /** Новый worker включился. */
  controllerChanged() {
    this.listeners.forEach((listener) => listener());
  }
}

const REMOTE_NEW: IRemoteVersion = { version: '0.10.0', build: 'new' };

function setup(overrides: Partial<IAppUpdateEnv> = {}) {
  const container = new FakeContainer();
  const timers: Array<() => void> = [];
  const env: IAppUpdateEnv = {
    build: 'old',
    container,
    fetchVersion: vi.fn(async () => REMOTE_NEW),
    reload: vi.fn(),
    setTimeout: (callback) => timers.push(callback),
    ...overrides,
  };
  return {
    env,
    container,
    updater: createAppUpdater(env),
    fireTimers: () => timers.forEach((t) => t()),
  };
}

describe('проверка обновления', () => {
  it('на сервере другая сборка — «доступна», worker начинает её скачивать', async () => {
    const { updater, container } = setup();
    const { result, remote } = await updater.check();
    expect(result).toBe('available');
    expect(remote).toEqual(REMOTE_NEW);
    expect(container.registration!.update).toHaveBeenCalled();
  });

  it('та же сборка — «последняя»; ожидающий worker от прошлой сессии включается молча', async () => {
    const { updater, container, env } = setup({
      fetchVersion: vi.fn(async () => ({ version: '0.9.0', build: 'old' })),
    });
    const leftover = new FakeWorker();
    container.registration!.waiting = leftover;

    expect((await updater.check()).result).toBe('latest');
    expect(leftover.postMessage).toHaveBeenCalledWith(UPDATE_MESSAGE);

    // Включился — страница уже та, что нужно: не перезагружаемся.
    container.controllerChanged();
    expect(env.reload).not.toHaveBeenCalled();
  });

  it('нет сети или файла (разработка) — «не удалось», без исключения', async () => {
    const { updater } = setup({ fetchVersion: vi.fn(async () => null) });
    expect((await updater.check()).result).toBe('failed');
  });

  it('первая установка worker меняет controller — перезагрузки нет', async () => {
    const { updater, container, env } = setup();
    await updater.check();
    container.controllerChanged();
    expect(env.reload).not.toHaveBeenCalled();
  });
});

describe('«Обновить»', () => {
  it('ожидающему worker — сообщение, после его включения — одна перезагрузка', async () => {
    const { updater, container, env } = setup();
    const waiting = new FakeWorker();
    container.registration!.waiting = waiting;

    await updater.apply();
    expect(waiting.postMessage).toHaveBeenCalledWith(UPDATE_MESSAGE);
    expect(env.reload).not.toHaveBeenCalled();

    container.controllerChanged();
    container.controllerChanged();
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it('новый worker ещё качается — дождаться установки, потом включить', async () => {
    const { updater, container, env } = setup();
    const registration = container.registration!;
    const applying = updater.apply();
    await Promise.resolve();
    await Promise.resolve();

    const worker = registration.found();
    registration.installed(worker);
    await applying;

    expect(worker.postMessage).toHaveBeenCalledWith(UPDATE_MESSAGE);
    container.controllerChanged();
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it('worker так и не встал — перезагрузка без него: навигация всё равно идёт в сеть', async () => {
    const { updater, env, fireTimers } = setup();
    const applying = updater.apply();
    await Promise.resolve();
    await Promise.resolve();
    fireTimers();
    await applying;
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it('worker включили, а controllerchange не пришёл — перезагрузка по тайм-ауту', async () => {
    const { updater, container, env, fireTimers } = setup();
    container.registration!.waiting = new FakeWorker();
    await updater.apply();
    fireTimers();
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it('без service worker (разработка, старый браузер) — просто перезагрузка', async () => {
    const { updater, env } = setup({ container: undefined });
    await updater.apply();
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it('страница не под worker — перезагрузка', async () => {
    const { updater, container, env } = setup();
    container.controller = null;
    await updater.apply();
    expect(env.reload).toHaveBeenCalledTimes(1);
  });
});
