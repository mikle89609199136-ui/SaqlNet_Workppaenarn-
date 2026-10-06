import { Button, Icon, type IRichTextInputHandle } from '@/shared/ui';
import { MediaComposerPicker } from '@/features/stickers-gifs';
import type { IGif, ISticker } from '@/entities/media';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

const PANEL_ID = 'media-composer-panel';

interface Props {
  draftRef: RefObject<IRichTextInputHandle | null>;
  disabled?: boolean;
  onPickSticker?: (sticker: ISticker) => void;
  onPickGif?: (gif: IGif) => void;
}

/**
 * Эмодзи, стикеры и GIF в поле ввода (#593): кнопка-смайлик справа от поля
 * и панель над карточкой с вкладками первого уровня.
 */
export const EmojiControl = ({ draftRef, disabled, onPickSticker, onPickGif }: Props) => {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        aria-controls={open ? PANEL_ID : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('emoji.title', 'Эмодзи')}
        className="aria-expanded:bg-brand-soft aria-expanded:text-brand"
        disabled={disabled}
        iconOnly
        onClick={() => setOpen((value) => !value)}
        ref={buttonRef}
        variant="ghost"
      >
        <Icon className="size-5" name="smile" />
      </Button>

      {open && (
        <EmojiPanel
          anchorRef={buttonRef}
          onClose={() => setOpen(false)}
          onPickEmoji={(emoji) => draftRef.current?.insertText(emoji)}
          onPickGif={onPickGif}
          onPickSticker={onPickSticker}
        />
      )}
    </>
  );
};

/** Открытая панель: закрывается нажатием мимо и Escape. */
function EmojiPanel({
  anchorRef,
  onClose,
  onPickEmoji,
  onPickSticker,
  onPickGif,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onPickEmoji: (emoji: string) => void;
  onPickSticker?: (sticker: ISticker) => void;
  onPickGif?: (gif: IGif) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Фокус — в панель, а не в поиск: на телефоне поиск поднял бы
    // клавиатуру поверх самих эмодзи.
    panelRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // Кнопка сама закрывает панель своим нажатием.
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [anchorRef]);

  return (
    <MediaComposerPicker
      className="absolute right-0 bottom-full z-30 mb-2 w-89 origin-bottom-right transition-[opacity,translate,scale] duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] outline-none max-md:w-full motion-reduce:transition-none starting:translate-y-2 starting:scale-96 starting:opacity-0"
      id={PANEL_ID}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onCloseRef.current();
        anchorRef.current?.focus();
      }}
      onPickEmoji={onPickEmoji}
      onPickGif={(gif) => {
        onPickGif?.(gif);
        onCloseRef.current();
      }}
      onPickSticker={(sticker) => {
        onPickSticker?.(sticker);
        onCloseRef.current();
      }}
      ref={panelRef}
    />
  );
}
