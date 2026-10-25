import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/shared/api';
import { chatKeys, readDraft, writeDraft } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { clearToasts, getToasts } from '@/shared/ui';
import { signOut } from './signOut';

const UNCONFIRMED = 'Сервер не ответил — выход выполнен только на этом устройстве';

/* Один путь выхода для всех кнопок (#1072): сначала сервер, затем — при
   любом исходе — очистка вкладки; молчание или отказ сервера не скрываются. */
describe('выход из аккаунта', () => {
  beforeEach(() => {
    queryClient.clear();
    clearToasts();
    useProfileStore.setState({ isAuth: true });
    writeDraft('chat-1', 'недописанное');
    queryClient.setQueryData(chatKeys.messages('chat-1'), { pages: [[]], pageParams: [0] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearToasts();
  });

  it('успех: вкладка очищена, ключи в памяти забыты, тоста нет', async () => {
    const logout = vi.spyOn(services.authService, 'logout').mockResolvedValue(undefined);
    const forgetSession = vi.spyOn(services.cryptoService, 'forgetSession');

    await signOut();

    expect(logout).toHaveBeenCalledTimes(1);
    expect(readDraft('chat-1')).toBe('');
    expect(queryClient.getQueryData(chatKeys.messages('chat-1'))).toBeUndefined();
    expect(useProfileStore.getState().isAuth).toBe(false);
    expect(forgetSession).toHaveBeenCalled();
    expect(getToasts()).toEqual([]);
  });

  it('очистка — после запроса: сервер получает его, пока сессия ещё на месте', async () => {
    let signedInAtRequest: boolean | null = null;
    vi.spyOn(services.authService, 'logout').mockImplementation(async () => {
      signedInAtRequest = useProfileStore.getState().isAuth;
    });

    await signOut();

    expect(signedInAtRequest).toBe(true);
  });

  it.each([
    ['сервер ответил ошибкой', Object.assign(new Error('internal'), { status: 500 })],
    ['нет сети', new TypeError('Failed to fetch')],
  ])('%s — очистка та же и тост', async (_name, failure) => {
    vi.spyOn(services.authService, 'logout').mockRejectedValue(failure);

    await signOut();

    expect(readDraft('chat-1')).toBe('');
    expect(useProfileStore.getState().isAuth).toBe(false);
    expect(getToasts()).toEqual([expect.objectContaining({ message: UNCONFIRMED })]);
  });

  it('сервер молчит — не ждём дольше срока', async () => {
    vi.spyOn(services.authService, 'logout').mockReturnValue(new Promise(() => {}));

    await signOut({ timeoutMs: 20 });

    expect(useProfileStore.getState().isAuth).toBe(false);
    expect(getToasts()).toEqual([expect.objectContaining({ message: UNCONFIRMED })]);
  });

  it('повторный вызов, пока первый ждёт ответа, — без ошибок, очистка одна', async () => {
    let finish!: () => void;
    vi.spyOn(services.authService, 'logout').mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const forgetSession = vi.spyOn(services.cryptoService, 'forgetSession');

    const first = signOut();
    const second = signOut();
    finish();
    await Promise.all([first, second]);

    expect(forgetSession).toHaveBeenCalledTimes(1);
    expect(useProfileStore.getState().isAuth).toBe(false);
  });
});
