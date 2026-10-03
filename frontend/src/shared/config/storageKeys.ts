export const STORAGE_KEYS = {
  /**
   * Токен прежней версии (до #705) — только чтобы один раз обменять его на
   * cookie сессии (`exchangeLegacySession`) и стереть. Новый клиент токен не
   * хранит: он в HttpOnly-cookie. Удаляется при уборке #705.
   */
  LEGACY_TOKEN: 'craneapp_auth_token',
  /** Сохранённый профиль. Есть — человек вошёл (сама сессия — в cookie). */
  USER: 'craneapp_user_data',
  SETTINGS: 'craneapp_settings',
  LANGUAGE: 'craneapp_language',
  PANE_WIDTHS: 'craneapp_pane_widths',
  RECENT_EMOJI: 'craneapp_recent_emoji',
  /** Палитра фона и акцент — только в браузере, пока нет #728. */
  APPEARANCE: 'craneapp_appearance',
};

export type TStorageKeyTypes = keyof typeof STORAGE_KEYS;
