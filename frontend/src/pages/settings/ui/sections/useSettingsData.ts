import { showToast } from '@/shared/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  normalizePreferences,
  settingsQuery,
  useUpdatePrivacy,
  useUpdateSettings,
  userKeys,
  settingsSession,
  isSettingsSession,
} from '@/entities/user';
import type { IPrivacyDto, ISettingsDto, ISettingsPayloadDto } from '@/types';

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
  // Сообщения берутся с экземпляра `i18n` в момент показа, а не из `t`
  // этой отрисовки: сохранение может само сменить язык, и `t`, пойманный
  // до смены, выдал бы тост на прежнем языке.
  const { i18n } = useTranslation();
  const client = useQueryClient();
  const { data, isPending } = useQuery(settingsQuery());
  const updateSettings = useUpdateSettings();
  const updatePrivacy = useUpdatePrivacy();

  const settings = normalizePreferences(data?.settings);
  const privacy: Partial<IPrivacyDto> = data?.privacy ?? {};

  function saveSettings(patch: Partial<ISettingsDto>, onSaved?: () => void) {
    const session = settingsSession();
    const confirmedLanguage = () =>
      client.getQueryData<ISettingsPayloadDto>(userKeys.settings(session))?.settings?.language ??
      i18n.language;
    updateSettings.mutate(patch, {
      onSuccess: async () => {
        // useApplyPreferences applies the canonical cache. A late PUT callback
        // must not reinstall patch.language after a newer remote change.
        await i18n.loadLanguages(confirmedLanguage()).catch(() => {});
        if (!isSettingsSession(session)) return;
        onSaved?.();
        showToast(
          'success',
          i18n.getFixedT(confirmedLanguage())('settingsSaved', 'Настройки сохранены')
        );
      },
      onError: () =>
        showToast('error', i18n.t('toast.settingsFailed', 'Не удалось сохранить настройки')),
    });
  }

  function savePrivacy(patch: Partial<IPrivacyDto>) {
    updatePrivacy.mutate(patch, {
      onSuccess: () =>
        showToast('success', i18n.t('toast.privacySaved', 'Настройки приватности сохранены')),
      onError: () =>
        showToast(
          'error',
          i18n.t('toast.privacyFailed', 'Не удалось сохранить настройки приватности')
        ),
    });
  }

  return {
    settings,
    privacy,
    isPending,
    isSaving: updateSettings.isPending,
    saveSettings,
    savePrivacy,
  };
}
