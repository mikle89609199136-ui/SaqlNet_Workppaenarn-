import { Icon } from '@/shared/ui';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface Props {
  container: HTMLElement;
}

export function FileDropOverlay({ container }: Props) {
  const { t } = useTranslation();

  return createPortal(
    <div
      className="pointer-events-none absolute inset-0 z-50 flex p-3 bg-sheet/85 backdrop-blur-sm"
      data-testid="file-drop-overlay"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-window border-2 border-dashed border-brand text-brand">
        <Icon className="size-10" name="paperclip" />
        <p className="text-ui font-medium">
          {t('dropFilesHint', 'Перетащите файлы сюда, чтобы отправить')}
        </p>
      </div>
    </div>,
    container
  );
}
