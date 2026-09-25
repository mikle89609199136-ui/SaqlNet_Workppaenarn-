import { showToast } from '@/shared/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_PROFILE_SETTINGS,
  settingsQuery,
  useUpdatePrivacy,
  useUpdateSettings,
  type IPrivacyDto,
  type ISettingsDto,
} from '@/entities/user';

/**
 * Настройки и способ их менять — то общее, что нужно почти каждому разделу.
 *
 * Вынесено, чтобы четыре раздела не повторяли одну и ту же связку из
 * запроса, двух мутаций и сообщений. Показ значения до ответа сервера и
 * откат при ошибке живут в самих мутациях; здесь остаются только
 * умолчания и текст сообщений.
 *
 * Умолчания подставляются при чтении, а не при записи: сервер вправе не
 * прислать поле, которого у пользователя ещё нет, и на сервер всё равно
 * уходит только изменённое.
 */
export function useSettingsData() {
  const { t } = useTranslation();
  const { data, isPending } = useQuery(settingsQuery());
  const updateSettings = useUpdateSettings();
  const updatePrivacy = useUpdatePrivacy();

  const settings: ISettingsDto = { ...DEFAULT_PROFILE_SETTINGS, ...(data?.settings ?? {}) };
  const privacy: Partial<IPrivacyDto> = data?.privacy ?? {};

  function saveSettings(patch: Partial<ISettingsDto>) {
    updateSettings.mutate(patch, {
      onSuccess: () => showToast('success', t('settingsSaved', 'Настройки сохранены')),
      onError: () =>
        showToast('error', t('toast.settingsFailed', 'Не удалось сохранить настройки')),
    });
  }

  function savePrivacy(patch: Partial<IPrivacyDto>) {
    updatePrivacy.mutate(patch, {
      onSuccess: () =>
        showToast('success', t('toast.privacySaved', 'Настройки приватности сохранены')),
      onError: () =>
        showToast('error', t('toast.privacyFailed', 'Не удалось сохранить настройки приватности')),
    });
  }

  return { settings, privacy, isPending, saveSettings, savePrivacy };
}
