import { retryChatEncryption } from '@/features/chat-encryption';
import { Banner, Button } from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { composerFooter } from './composerStyles';

/**
 * Вместо поля ввода, когда шифрование чата недоступно — по макету (#826).
 *
 * Писать некуда: без ключа сообщение не зашифровать, а открытым текстом
 * оно не уходит. «Проверить» готовит шифрование заново — ключ мог
 * появиться, пока плашка висела.
 */
export function EncryptionUnavailableComposer({ chatId }: { chatId: string }) {
  const { t } = useTranslation();

  return (
    <div className={composerFooter}>
      <Banner
        action={
          <Button
            className="bg-brand-soft"
            onClick={() => retryChatEncryption(chatId)}
            size="sm"
            variant="accent"
          >
            {t('encryption.check', 'Проверить')}
          </Button>
        }
        icon="lock"
        tone="warn"
      >
        <b>{t('encryption.unavailableTitle', 'Шифрование недоступно.')}</b>{' '}
        {t(
          'encryption.unavailableText',
          'Ключ чата ещё не готов — написать можно будет, когда собеседник появится в сети.'
        )}
      </Banner>
    </div>
  );
}
