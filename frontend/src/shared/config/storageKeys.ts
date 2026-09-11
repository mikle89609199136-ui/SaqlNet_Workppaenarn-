export const STORAGE_KEYS = {
  TOKEN: 'craneapp_auth_token',
  USER: 'craneapp_user_data',
  SETTINGS: 'craneapp_settings',
  LANGUAGE: 'craneapp_language',
  PANE_WIDTHS: 'craneapp_pane_widths',
};

export type TStorageKeyTypes = keyof typeof STORAGE_KEYS;
