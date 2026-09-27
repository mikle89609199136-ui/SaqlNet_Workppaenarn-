import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast, type TToastType } from '@/shared/ui';
import type { IVoiceRecorderState, TVoiceRecorderError } from './voiceRecorder';

/** Ошибка записи — человеку словами, один раз на каждую новую ошибку. */
export function useVoiceErrorToast(state: IVoiceRecorderState) {
  const { t } = useTranslation();
  const { error } = state;

  useEffect(() => {
    if (!error) return;
    const messages: Record<TVoiceRecorderError, [TToastType, string]> = {
      permission: [
        'error',
        t('voice.error.permission', 'Нет доступа к микрофону. Разрешите его в настройках браузера'),
      ],
      'no-device': ['error', t('voice.error.noDevice', 'Микрофон не найден')],
      busy: ['error', t('voice.error.busy', 'Микрофон занят другим приложением')],
      insecure: [
        'error',
        t('voice.error.insecure', 'Запись голоса доступна только по защищённому адресу (HTTPS)'),
      ],
      unsupported: [
        'error',
        t('voice.error.unsupported', 'Этот браузер не умеет записывать голосовые'),
      ],
      'device-lost': [
        'warning',
        t('voice.error.deviceLost', 'Микрофон отключился — записанное можно отправить'),
      ],
      'too-short': [
        'info',
        t('voice.error.tooShort', 'Удерживайте кнопку, чтобы записать голосовое'),
      ],
      unknown: ['error', t('voice.error.unknown', 'Не удалось записать голосовое')],
    };
    const [type, message] = messages[error];
    showToast(type, message);
  }, [error, t]);
}
