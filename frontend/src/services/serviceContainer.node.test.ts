import { STORAGE_KEYS } from '@/shared/config';
import { useProfileStore } from '@/entities/user/model/profileStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServices, services, startCryptoAutoInit } from './serviceContainer';

describe('контейнер сервисов', () => {
  beforeEach(() => {
    useProfileStore.setState({ user: null, isAuth: false });
  });

  it('should not start crypto initialisation on import', () => {
    // Импорт модуля не должен ничего запускать: иначе любой тест, которому
    // нужен один сервис, поднимает криптографию и вешает таймер.
    expect(services.cryptoService.getAccountId()).toBeNull();
  });

  it('should build an isolated set of services', () => {
    const first = createServices();
    const second = createServices();

    expect(first.messageService).not.toBe(second.messageService);
    expect(first.messageService).not.toBe(services.messageService);
  });

  it('should share one crypto service between message and container', () => {
    const isolated = createServices();

    // MessageService шифрует через тот же экземпляр, что отдаёт контейнер:
    // иначе ключи в них разойдутся.
    expect(isolated.messageService['cryptoService']).toBe(isolated.cryptoService);
  });
});

describe('доступ к профилю из AuthService', () => {
  beforeEach(() => {
    useProfileStore.setState({ user: null, isAuth: false });
  });

  it('пишет профиль в хранилище — сам вход держится на cookie (#705)', () => {
    services.authService.authStorage.setUser({ id: 'user-1', username: 'anna' } as never);

    expect(useProfileStore.getState().user?.id).toBe('user-1');
    expect(useProfileStore.getState().isAuth).toBe(true);
  });

  it('токена в хранилище нет и из AuthService его не записать', () => {
    expect('token' in useProfileStore.getState()).toBe(false);
    expect('setToken' in services.authService.authStorage).toBe(false);
  });
});

describe('автоинициализация криптографии', () => {
  it('should do nothing without a browser', () => {
    // В окружении node window отсутствует — функция обязана вернуть
    // безопасную заглушку, а не упасть.
    const stop = startCryptoAutoInit();

    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });

  it('should skip initialisation when the session is empty', () => {
    const target = createServices();
    const init = vi.spyOn(target.cryptoService, 'init');

    localStorage.removeItem(STORAGE_KEYS.USER);
    startCryptoAutoInit(target)();

    expect(init).not.toHaveBeenCalled();
  });
});
