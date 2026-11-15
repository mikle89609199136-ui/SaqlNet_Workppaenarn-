import { useTranslation } from 'react-i18next';
import { useChatUiStore } from '@/entities/chat';
import { ConfirmDialog } from '@/shared/ui';
import { rememberTranslatorConsent } from '@/services/translatorConsent';
import type { IMessageDto } from '@/types';

interface Props {
  onConfirm: (targets: IMessageDto[]) => void;
}

/**
 * Диалог согласия на отправку текста во внешний переводчик Google Translate (#1085).
 * Показывается один раз на аккаунт при первом запросе перевода сообщений.
 */
export function TranslatorConsentDialog({ onConfirm }: Props) {
  const { t } = useTranslation();
  const request = useChatUiStore((state) => state.translatorConsentRequest);
  const setRequest = useChatUiStore((state) => state.setTranslatorConsentRequest);

  if (!request) return null;

  const handleConfirm = () => {
    rememberTranslatorConsent();
    const targets = request.targets;
    setRequest(null);
    onConfirm(targets);
  };

  const handleCancel = () => {
    setRequest(null);
  };

  return (
    <ConfirmDialog
      cancelLabel={t('cancel', 'Отмена')}
      confirmLabel={t('continueAction', 'Продолжить')}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
      open={Boolean(request)}
      title={t('translatorConsentTitle', 'Перевод сообщений')}
    >
      <p className="text-body text-ink-2">
        {t(
          'translatorConsent',
          'Текст сообщения будет отправлен в Google для перевода. Продолжить?'
        )}
      </p>
    </ConfirmDialog>
  );
}
