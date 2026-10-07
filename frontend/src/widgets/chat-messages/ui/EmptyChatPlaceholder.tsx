import { useTranslation } from 'react-i18next';

/* Переписка не выбрана — подпись-таблетка по центру ленты, как в макете
   (#818). Место под ленту остаётся пустым: там появится чат. */
export const EmptyChatPlaceholder = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <p className="rounded-pill bg-sheet-2 px-4 py-2 text-ui text-ink-2">
        {t('selectChatToStart', 'Выберите чат, чтобы начать переписку')}
      </p>
    </div>
  );
};
