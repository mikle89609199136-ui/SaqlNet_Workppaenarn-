import { useTranslation } from 'react-i18next';

export const EmptyChatListPlaceholder = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center p-4 text-center my-auto">
      <h2 className="text-xl font-medium mb-1 text-ink">{t('noChats', 'Чатов пока нет')}</h2>
      <p className="text-sm text-ink-3">
        {t('noChatsDesc', 'Начните общение, создав новый чат или выбрав контакт')}
      </p>
    </div>
  );
};
