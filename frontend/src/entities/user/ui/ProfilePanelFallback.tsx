import { Button, Icon } from '@/shared/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface IBarProps {
  onClose: () => void;
  /** «Назад» слева — когда панель открыта поверх другой (участник группы). */
  onBack?: () => void;
  backLabel?: string;
}

/**
 * Верхняя строка правой панели — по макету (#822): «Назад» цветом
 * акцента слева, если есть куда вернуться, и «Закрыть» справа.
 */
export function ProfilePanelBar({ onClose, onBack, backLabel }: IBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center px-2.5 pt-2.5">
      {onBack && (
        <Button
          aria-label={backLabel ?? t('back', 'Назад')}
          className="text-brand"
          iconOnly
          onClick={onBack}
          variant="ghost"
        >
          <Icon className="size-5.5 rotate-180 stroke-2" name="chevronRight" />
        </Button>
      )}
      <Button
        aria-label={t('closeProfile', 'Закрыть профиль')}
        className="ml-auto"
        iconOnly
        onClick={onClose}
        variant="ghost"
      >
        <Icon className="size-5" name="cross" />
      </Button>
    </div>
  );
}

interface Props extends IBarProps {
  ariaBusy?: boolean;
  children: ReactNode;
}

/** Панель, пока профиль грузится или не загрузился. */
export function ProfilePanelFallback({ ariaBusy, children, ...bar }: Props) {
  return (
    <aside aria-busy={ariaBusy} className="flex h-full flex-col bg-sheet" role="complementary">
      <ProfilePanelBar {...bar} />
      <div className="flex flex-1 items-center justify-center p-6 text-center text-ui text-ink-2">
        {children}
      </div>
    </aside>
  );
}
