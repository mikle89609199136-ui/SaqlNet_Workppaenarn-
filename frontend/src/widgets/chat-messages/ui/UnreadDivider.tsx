import { useTranslation } from 'react-i18next';

/* «Новые сообщения» — перед первым непрочитанным на момент открытия чата
   (#820). По макету: подпись цветом акцента между двумя линиями. */
export function UnreadDivider() {
  const { t } = useTranslation();
  const label = t('newMessages', 'Новые сообщения');

  return (
    <div
      aria-label={label}
      className="mt-3 mb-1.5 flex items-center gap-3 text-meta font-semibold text-brand select-none"
      role="separator"
    >
      <span aria-hidden="true" className="h-px flex-1 bg-brand opacity-45" />
      {label}
      <span aria-hidden="true" className="h-px flex-1 bg-brand opacity-45" />
    </div>
  );
}
