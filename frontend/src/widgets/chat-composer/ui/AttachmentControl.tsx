import { useChatUiStore } from '@/entities/chat';
import { cn } from '@/shared/lib';
import { Button, ContextMenu, Icon } from '@/shared/ui';
import type { TIconTypes } from '@/types';
import { useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  isSending: boolean;
}

/* Что открывает каждый пункт. Поле выбора файла одно на всё: перед
   открытием ему выставляются нужные типы и, для камеры, съёмка. */
const SOURCES = [
  {
    key: 'media',
    icon: 'image',
    tile: 'bg-brand-soft text-brand',
    accept: 'image/*,video/*',
    capture: false,
    label: ['attach.media', 'Фото или видео'],
    hint: ['attach.mediaHint', 'Из галереи'],
  },
  {
    key: 'camera',
    icon: 'camera',
    tile: 'bg-ok-soft text-ok',
    accept: 'image/*',
    capture: true,
    label: ['attach.camera', 'Сделать фото'],
    hint: ['attach.cameraHint', 'Камера устройства'],
  },
  {
    key: 'file',
    icon: 'file',
    tile: 'bg-info-soft text-info',
    accept: 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar',
    capture: false,
    label: ['attach.file', 'Файл'],
    hint: ['attach.fileHint', 'Документы, архивы, любые файлы'],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  icon: TIconTypes;
  tile: string;
  accept: string;
  capture: boolean;
  label: readonly [string, string];
  hint: readonly [string, string];
}>;

/**
 * Вложение — кнопка-скрепка и меню источников, как в макете (#821).
 *
 * Меню — тот же ContextMenu, что у сообщений: обход стрелками, Escape,
 * возврат фокуса на скрепку. Открытая скрепка подсвечена акцентом.
 */
export const AttachmentControl = ({ inputRef, onChange, isSending }: Props) => {
  const { t } = useTranslation();
  const editingMessage = useChatUiStore((state) => state.editingMessage);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const pick = (source: (typeof SOURCES)[number]) => {
    const input = inputRef.current;
    setOpen(false);
    if (!input) return;

    input.accept = source.accept;
    if (source.capture) input.setAttribute('capture', 'environment');
    else input.removeAttribute('capture');
    input.click();
  };

  return (
    <>
      <input
        accept={SOURCES[2].accept}
        aria-label={t('attachFile', 'Прикрепить файл')}
        className="hidden"
        onChange={onChange}
        ref={inputRef}
        type="file"
      />
      <Button
        aria-controls={open ? 'attach-menu' : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('attachFile', 'Прикрепить файл')}
        className="aria-expanded:bg-brand-soft aria-expanded:text-brand"
        disabled={isSending || Boolean(editingMessage)}
        iconOnly
        onClick={() => setOpen((value) => !value)}
        ref={buttonRef}
        variant="ghost"
      >
        <Icon className="size-5" name="paperclip" />
      </Button>

      <ContextMenu
        anchorRef={buttonRef}
        aria-label={t('attach.menu', 'Добавить вложение')}
        className="w-65 gap-0.5 rounded-dialog"
        id="attach-menu"
        onClose={() => setOpen(false)}
        open={open}
      >
        {SOURCES.map((source) => (
          <button
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-button px-2.5 py-2 text-left',
              'hover:layer-hover active:layer-press',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2'
            )}
            key={source.key}
            onClick={() => pick(source)}
            role="menuitem"
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-field',
                source.tile
              )}
            >
              <Icon className="size-4.75" name={source.icon} />
            </span>
            <span className="flex min-w-0 flex-col gap-px">
              <span className="text-ui font-medium text-ink">
                {t(source.label[0], source.label[1])}
              </span>
              <span className="text-meta text-ink-3">{t(source.hint[0], source.hint[1])}</span>
            </span>
          </button>
        ))}
      </ContextMenu>
    </>
  );
};
