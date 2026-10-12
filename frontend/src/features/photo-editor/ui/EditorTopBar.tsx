import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/shared/ui';

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Сбросить обрезку или фильтры — есть, только когда сбрасывать есть что. */
  onReset?: () => void;
}

/* Верхняя строка: отмена и повтор слева, «Сбросить» справа. Раньше
   отмена висела плашкой поверх фото и закрывала его верх. «Закрыть» и
   «Готово» — внизу, у большого пальца (EditorToolbar).

   На телефоне строка лежит прямо на чёрном поле фото, поэтому цвет —
   «поверх медиа» (on-scrim), а не ink: в светлой теме ink тёмный и на
   чёрном пропал бы. На десктопе это шапка на sheet, там обычные цвета. */
const onBlack = 'max-md:text-on-scrim';

export function EditorTopBar({ canUndo, canRedo, onUndo, onRedo, onReset }: Props) {
  const { t } = useTranslation();
  return (
    <header className="box-content flex h-13 items-center justify-between gap-2 px-2 pt-safe md:col-span-2 md:h-15 md:border-b md:border-line-soft md:bg-sheet md:px-4">
      <div className="flex items-center gap-1">
        <Button
          aria-label={t('photoEditor.undo', 'Отменить')}
          className={onBlack}
          disabled={!canUndo}
          iconOnly
          onClick={onUndo}
          variant="ghost"
        >
          <Icon name="undo" size="md" />
        </Button>
        <Button
          aria-label={t('photoEditor.redo', 'Повторить')}
          className={onBlack}
          disabled={!canRedo}
          iconOnly
          onClick={onRedo}
          variant="ghost"
        >
          <Icon name="redo" size="md" />
        </Button>
      </div>
      {onReset && (
        <Button className={onBlack} onClick={onReset} size="sm" variant="ghost">
          {t('photoEditor.reset', 'Сбросить')}
        </Button>
      )}
    </header>
  );
}
