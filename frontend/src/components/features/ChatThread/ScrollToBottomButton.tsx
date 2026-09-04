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
        className="relative size-10 p-0 shadow-[var(--elev-2)] hover:shadow-[var(--elev-3)] hover:bg-sheet active:scale-95"
        iconOnly
        onClick={onClick}
        shape="round"
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
