import { useProfileStore } from '@/entities/user';
import { fetchUserSettings, saveAuthSession } from '@/services/authApi';
import { services } from '@/services/serviceContainer';
import type { IQrLoginResult } from './useQrLogin';

/**
 * Вход по QR подтверждён: разложить сессию и ключ по местам.
 *
 * Мастер-ключ передаётся шифрованию до сохранения сессии: событие о
 * сохранении запускает подготовку ключей, и к этому моменту ключ уже
 * должен ждать — тогда история откроется без облачного пароля.
 */
export async function completeQrLogin({ masterKey }: IQrLoginResult): Promise<void> {
  // Сессию новому устройству сервер уже поставил в cookie — ответом на
  // подтверждённый статус входа (#705); хранить токен не нужно.
  const store = useProfileStore.getState();

  try {
    const user = await services.userService.getMe();
    const settings = await fetchUserSettings();

    if (masterKey) await services.cryptoService.acceptMasterKey(masterKey);
    saveAuthSession({ settings, user });
  } catch (error) {
    store.clearProfile();
    throw error;
  }
}
