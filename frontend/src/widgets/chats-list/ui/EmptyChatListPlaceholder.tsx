import { useTranslation } from 'react-i18next';

export const EmptyChatListPlaceholder = () => {
  const { t } = useTranslation();
  return (
    <div className="my-auto flex flex-col items-center gap-1 px-5 py-8 text-center">
      <h2 className="text-title font-semibold text-ink">{t('noChats', 'Чатов пока нет')}</h2>
      <p className="text-ui text-ink-3">
        {t('noChatsDesc', 'Начните общение, создав новый чат или выбрав контакт')}
      </p>
    </div>
  );
};
