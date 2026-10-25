import i18n from 'i18next';
import { services } from '@/services/serviceContainer';
import { showToast } from '@/shared/ui';
import { clearAuthSession } from './clearAuthSession';

/** Дольше ждать сервер незачем: вкладку очистим в любом случае. */
const LOGOUT_TIMEOUT_MS = 10_000;

const UNCONFIRMED = 'Сервер не ответил — выход выполнен только на этом устройстве';

interface ISignOutOptions {
  /** Сколько ждать ответа сервера. Параметром — для тестов. */
  timeoutMs?: number;
}

/**
 * Выход из аккаунта на этом устройстве — один путь для всех кнопок (#1072).
 *
 * Сначала сервер: он забывает push-подписку, пока сессия ещё действует, и
 * закрывает сессию. Потом — всегда, при любом исходе — очистка вкладки:
 * черновики, превью, ключи в памяти, очередь, кеш. Прежде кнопки чистили
 * только кеш и сокет, а ошибку сервера молча глотали.
 *
 * Сервер не ответил или ответил ошибкой — человек всё равно выходит, но
 * узнаёт, что выход подтверждён только здесь: сессию в HttpOnly-cookie
 * стереть может только сервер (#705). О роутере функция не знает —
 * переход на вход делает вызывающий.
 */
export async function signOut({ timeoutMs = LOGOUT_TIMEOUT_MS }: ISignOutOptions = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('logout timed out')), timeoutMs);
  });

  try {
    // Сам запрос не отменяется: дойдёт — сессия закроется и так.
    await Promise.race([services.authService.logout(), timeout]);
  } catch {
    // До инициализации i18next отдаёт undefined даже с запасной строкой.
    showToast('error', i18n.t('toast.logoutUnconfirmed', UNCONFIRMED) ?? UNCONFIRMED);
  } finally {
    clearTimeout(timer);
    // Повторный вызов безопасен: если 401 из запроса в пути успел
    // очистить вкладку раньше, второй раз ничего не произойдёт.
    clearAuthSession();
  }
}
