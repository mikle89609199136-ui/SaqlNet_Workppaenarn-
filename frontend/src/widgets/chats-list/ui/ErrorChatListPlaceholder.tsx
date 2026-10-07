import { Button } from '@/shared/ui';
import { useTranslation } from 'react-i18next';

interface Props {
  message?: string;
  onRetry?: () => void;
}

/* Список не загрузился. Кнопка повтора: прежде обработчик приходил, но
   нажать было не на что — оставалось обновлять страницу целиком. */
export const ErrorChatListPlaceholder = ({ message, onRetry }: Props) => {
  const { t } = useTranslation();
  return (
    <div className="my-auto flex flex-col items-center gap-1 px-5 py-8 text-center">
      <h2 className="text-title font-semibold text-ink">{t('error', 'Ошибка')}</h2>
      <p className="text-ui text-ink-3">
        {message ||
          t('chatsLoadingError', 'Не удалось загрузить чаты. Попробуйте обновить страницу')}
      </p>
      {onRetry && (
        <Button className="mt-3" onClick={onRetry} size="sm" variant="secondary">
          {t('retry', 'Повторить')}
        </Button>
      )}
    </div>
  );
};
