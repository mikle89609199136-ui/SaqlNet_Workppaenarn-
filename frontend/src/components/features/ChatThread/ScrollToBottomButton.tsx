import { Button, Icon } from '@/components/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  visible: boolean;
  onClick: () => void;
}

export const ScrollToBottomButton = memo(({ visible, onClick }: Props) => {
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <div className="absolute right-4 bottom-4 z-20 transition-all duration-fast">
      <Button
        aria-label={t('scrollToBottom', 'Перейти к последним сообщениям')}
        className="relative rounded-full size-10 min-h-0 p-0 flex items-center justify-center shadow-[var(--elev-2)] hover:shadow-[var(--elev-3)] active:scale-95 bg-sheet-2 hover:bg-sheet border border-line text-ink"
        iconOnly
        onClick={onClick}
        size="md"
        title={t('scrollToBottom', 'Перейти к последним сообщениям')}
        variant="secondary"
      >
        <Icon name="chevronDown" size="md" />
      </Button>
    </div>
  );
});

ScrollToBottomButton.displayName = 'ScrollToBottomButton';
