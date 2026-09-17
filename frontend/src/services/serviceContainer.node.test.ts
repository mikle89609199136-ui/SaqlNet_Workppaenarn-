import { STORAGE_KEYS } from '@/shared/config';
import { useProfileStore } from '@/entities/user/model/profileStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServices, services, startCryptoAutoInit } from './serviceContainer';

describe('контейнер сервисов', () => {
  beforeEach(() => {
    useProfileStore.setState({ token: '', user: null });
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
    useProfileStore.setState({ token: '', user: null });
  });

  it('should read the token written after the container was built', () => {
    // Регрессия: раньше в AuthService передавался снимок getState(),
    // поэтому токен, полученный при входе, туда не попадал никогда.
    useProfileStore.getState().setToken('токен-после-входа');

    expect(services.authService.authStorage.token).toBe('токен-после-входа');
  });

  it('should write through to the store', () => {
    services.authService.authStorage.setToken('токен-из-сервиса');

    expect(useProfileStore.getState().token).toBe('токен-из-сервиса');
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

    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    startCryptoAutoInit(target)();

    expect(init).not.toHaveBeenCalled();
  });
});
