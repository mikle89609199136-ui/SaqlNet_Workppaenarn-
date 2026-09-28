import { Icon } from '@/shared/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  visible: boolean;
  onClick: () => void;
  /** Сколько новых ниже экрана — счётчиком на кнопке. */
  unread?: number;
}

/* Кнопка «вниз» — по макету (#820): круг 44 на фоне меню с тенью,
   счётчик новых сверху справа. */
export const ScrollToBottomButton = memo(({ visible, onClick, unread = 0 }: Props) => {
  const { t } = useTranslation();

  if (!visible) return null;

  const label =
    unread > 0
      ? `${t('scrollToBottom', 'Перейти к последним сообщениям')}, ${t('unreadCount', 'непрочитанных')}: ${unread}`
      : t('scrollToBottom', 'Перейти к последним сообщениям');

  return (
    <button
      aria-label={label}
      className="absolute right-5 bottom-4 z-20 flex size-11 items-center justify-center rounded-pill border border-divider bg-menu text-ink-2 shadow-[var(--shadow-menu)] transition-transform duration-fast hover:layer-hover active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
      onClick={onClick}
      title={t('scrollToBottom', 'Перейти к последним сообщениям')}
      type="button"
    >
      <Icon className="size-5.5 stroke-2" name="chevronDown" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-2 -right-1 flex h-5 min-w-5 items-center justify-center rounded-pill bg-brand-fill px-1.5 text-meta font-semibold text-on-brand tabular-nums"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
});

ScrollToBottomButton.displayName = 'ScrollToBottomButton';
