import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui';

interface Props {
  onToggle: () => void;
  shown: boolean;
}

export function PasswordToggle({ onToggle, shown }: Props) {
  const { t } = useTranslation();
  return (
    <button
      aria-label={shown ? t('hidePassword', 'Скрыть пароль') : t('showPassword', 'Показать пароль')}
      className="flex size-10 cursor-pointer items-center justify-center rounded-field text-ink-3 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
      onClick={onToggle}
      type="button"
    >
      <Icon className="stroke-[1.8px]" name={shown ? 'eyeOff' : 'eye'} size="md" />
    </button>
  );
}
