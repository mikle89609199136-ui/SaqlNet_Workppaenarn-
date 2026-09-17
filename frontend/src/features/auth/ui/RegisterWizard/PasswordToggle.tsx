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
      className="text-ink-2 transition-colors hover:text-ink"
      onClick={onToggle}
      type="button"
    >
      <Icon name={shown ? 'eyeOff' : 'eye'} size="md" />
    </button>
  );
}
