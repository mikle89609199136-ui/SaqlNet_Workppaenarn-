import { Button, Icon } from '@/components/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  ariaBusy?: boolean;
  children: ReactNode;
  onClose: () => void;
}

export function ProfilePanelFallback({ ariaBusy, children, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <aside aria-busy={ariaBusy} className="h-full flex flex-col bg-sheet p-4" role="complementary">
      <div className="w-full flex items-center justify-between pb-3 border-b border-line">
        <h3 className="text-title font-semibold text-ink">{t('profile', 'Профиль')}</h3>
        <Button
          aria-label={t('close', 'Закрыть')}
          iconOnly
          onClick={onClose}
          size="sm"
          variant="ghost"
        >
          <Icon name="cross" />
        </Button>
      </div>
      <div className="flex-1 flex items-center justify-center text-ink-2 text-body p-6 text-center">
        {children}
      </div>
    </aside>
  );
}
