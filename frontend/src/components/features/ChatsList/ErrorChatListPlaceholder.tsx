import { useTranslation } from 'react-i18next';

export const ErrorChatListPlaceholder = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center p-4 text-center my-auto">
      <h2 className="text-xl font-medium mb-1 text-ink">{t('error', 'Ошибка')}</h2>
      <p className="text-sm text-ink-3">
        {t('chatsLoadingError', 'Не удалось загрузить чаты. Попробуйте обновить страницу')}
      </p>
    </div>
  );
};
