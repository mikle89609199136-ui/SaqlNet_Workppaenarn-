import { useIsMutating, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { STORAGE_KEYS } from '@/shared/config';
import { settingsQuery } from './settingsQuery';
import { userKeys } from './userKeys';
import { useProfileStore } from './profileStore';
import { applyAppearance, normalizePreferences } from './appearancePreferences';

/** Кеш запроса — единственный источник preferences. На диске только ранняя проекция владельца. */
export function useApplyPreferences(): void {
  const { i18n } = useTranslation();
  const { data } = useQuery({ ...settingsQuery(), enabled: false });
  const ownerId = useProfileStore((state) => state.user?.id);
  const saving = useIsMutating({ mutationKey: userKeys.settings() }) > 0;
  const settings = data?.settings;

  useEffect(() => {
    if (!settings) return;
    const preferences = normalizePreferences(settings);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyAppearance(preferences, media.matches);
    apply();
    if (preferences.theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);

  useEffect(() => {
    if (!settings || saving || !ownerId) return;
    const { theme, palette, accentPreset, textSize, chatDensity, language } =
      normalizePreferences(settings);
    try {
      localStorage.setItem(
        STORAGE_KEYS.SETTINGS,
        JSON.stringify({
          ownerId,
          theme,
          palette,
          accentPreset,
          textSize,
          chatDensity,
          language,
        })
      );
    } catch {
      /* Хранилище необязательно для применения preferences. */
    }
  }, [settings, saving, ownerId]);

  const language = settings?.language;
  useEffect(() => {
    if (!language) return;
    document.documentElement.lang = language;
    // Load first: an older dictionary response must not switch the interface
    // back after a newer preference (or a different owner) has arrived.
    let active = true;
    void i18n
      .loadLanguages(language)
      .then(() => {
        if (active && i18n.language !== language) return i18n.changeLanguage(language);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [i18n, language, ownerId]);
}
