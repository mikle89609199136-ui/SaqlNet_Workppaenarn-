import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type BaseSelection,
  type TextFormatType,
} from 'lexical';
import { $isLinkNode, $toggleLink } from '@lexical/link';
import { $createQuoteNode, $isQuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { $findMatchingParent } from '@lexical/utils';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContextMenu } from '@/shared/ui/ContextMenu';
import { Icon } from '@/shared/ui/Icon';
import { cn } from '@/shared/lib';
import type { TIconTypes } from '@/types';
import { isLinkShortcut, shortcutHint } from './formatShortcuts';
import { LinkDialog } from './LinkDialog';

interface IFormatItem {
  format: TextFormatType;
  icon: TIconTypes;
  labelKey: string;
  label: string;
  shortcut?: string;
}

/* Спойлер в редакторе — формат highlight, моноширинный — code: своих
   форматов для них у Lexical нет. */
const FORMAT_ITEMS: IFormatItem[] = [
  { format: 'bold', icon: 'bold', labelKey: 'format.bold', label: 'Жирный', shortcut: 'Ctrl+B' },
  {
    format: 'italic',
    icon: 'italic',
    labelKey: 'format.italic',
    label: 'Курсив',
    shortcut: 'Ctrl+I',
  },
  {
    format: 'underline',
    icon: 'underline',
    labelKey: 'format.underline',
    label: 'Подчёркнутый',
    shortcut: 'Ctrl+U',
  },
  {
    format: 'strikethrough',
    icon: 'strikethrough',
    labelKey: 'format.strikethrough',
    label: 'Зачёркнутый',
    shortcut: shortcutHint('strikethrough'),
  },
  {
    format: 'code',
    icon: 'code',
    labelKey: 'format.monospace',
    label: 'Моноширинный',
    shortcut: shortcutHint('code'),
  },
  {
    format: 'highlight',
    icon: 'eyeOff',
    labelKey: 'format.spoiler',
    label: 'Скрытый текст',
    shortcut: shortcutHint('highlight'),
  },
];

interface IMenuState {
  x: number;
  y: number;
  view: 'main' | 'format';
}

interface ISelectionInfo {
  hasText: boolean;
  formats: ReadonlySet<TextFormatType>;
  linkUrl: string | null;
  quote: boolean;
}

const NOTHING: ISelectionInfo = { hasText: false, formats: new Set(), linkUrl: null, quote: false };

/** Уже применённое к выделению — подсвечено, как нажатая кнопка. */
const ACTIVE = 'bg-brand-soft text-brand hover:text-brand';

/**
 * Своё контекстное меню поля ввода, как в Telegram (#656).
 *
 * Правый клик — правка (отменить, вырезать, копировать, вставить…) и
 * «Форматирование», которое открывается в том же меню, а не выпадающим
 * подменю: так оно одинаково работает мышью, пальцем и с клавиатуры.
 * Форматировать можно только выделенное. Адрес ссылки спрашивается в окне.
 *
 * Выделение запоминается при открытии: фокус уходит в меню и в окно, а
 * действовать надо над тем, что было выделено.
 */
export function ComposerContextMenu() {
  const { t } = useTranslation();
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<IMenuState | null>(null);
  const [info, setInfo] = useState<ISelectionInfo>(NOTHING);
  const [linkDialog, setLinkDialog] = useState<{ url: string | null } | null>(null);
  const saved = useRef<BaseSelection | null>(null);

  const readSelection = useCallback(
    () =>
      editor.getEditorState().read((): ISelectionInfo => {
        const selection = $getSelection();
        saved.current = selection?.clone() ?? null;
        if (!$isRangeSelection(selection)) return NOTHING;

        const anchor = selection.anchor.getNode();
        return {
          hasText: !selection.isCollapsed(),
          formats: new Set(
            FORMAT_ITEMS.map((item) => item.format).filter((format) => selection.hasFormat(format))
          ),
          linkUrl: $findMatchingParent(anchor, $isLinkNode)?.getURL() ?? null,
          quote: Boolean($findMatchingParent(anchor, $isQuoteNode)),
        };
      }),
    [editor]
  );

  useEffect(() => {
    const open = (event: MouseEvent) => {
      if (!editor.isEditable()) return;
      event.preventDefault();
      setInfo(readSelection());
      setMenu({ x: event.clientX, y: event.clientY, view: 'main' });
    };

    return editor.registerRootListener((root, previous) => {
      previous?.removeEventListener('contextmenu', open);
      root?.addEventListener('contextmenu', open);
    });
  }, [editor, readSelection]);

  const close = useCallback(() => setMenu(null), []);

  /** Вернуть фокус и выделение в поле, затем выполнить действие. */
  const restore = () => {
    editor.focus();
    editor.update(() => {
      if (saved.current) $setSelection(saved.current.clone());
    });
  };

  const run = (action: () => void) => {
    close();
    restore();
    editor.update(action);
  };

  const runCommand = (dispatch: () => void) => {
    close();
    restore();
    dispatch();
  };

  const removeSelected = () => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.removeText();
  };

  const selectedText = () =>
    editor.getEditorState().read(() => saved.current?.getTextContent() ?? '');

  const openLink = useCallback(() => {
    const current = readSelection();
    if (!current.hasText && !current.linkUrl) return;
    setMenu(null);
    setLinkDialog({ url: current.linkUrl });
  }, [readSelection]);

  // Ctrl+K — то же, что «Ссылка» в меню.
  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (!isLinkShortcut(event)) return false;
          event.preventDefault();
          openLink();
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor, openLink]
  );

  const applyLink = (url: string | null) => {
    setLinkDialog(null);
    restore();
    editor.update(() => $toggleLink(url));
  };

  const clearFormatting = () =>
    run(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      // extract() режет крайние узлы по границам выделения: снимается ровно выделенное.
      for (const node of selection.extract()) {
        if ($isTextNode(node)) node.setFormat(0);
      }
      $toggleLink(null);
      $setBlocksType(selection, () => $createParagraphNode());
    });

  const toggleQuote = () =>
    run(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () => (info.quote ? $createParagraphNode() : $createQuoteNode()));
    });

  const canPaste = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText);

  return (
    <>
      {/* key: при смене вида меню собирается заново и фокус встаёт на первый пункт. */}
      <ContextMenu
        aria-label={
          menu?.view === 'format'
            ? t('format.menu', 'Форматирование')
            : t('editMenu.label', 'Правка')
        }
        key={menu?.view}
        onClose={close}
        open={menu !== null}
        x={menu?.x}
        y={menu?.y}
      >
        {menu?.view === 'format' ? (
          <>
            <ContextMenu.Item
              icon={<Icon className="rotate-180" name="chevronRight" />}
              onClick={() => setMenu({ ...menu, view: 'main' })}
            >
              {t('back', 'Назад')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            {FORMAT_ITEMS.map(({ format, icon, labelKey, label, shortcut }) => (
              <ContextMenu.Item
                className={cn(info.formats.has(format) && ACTIVE)}
                icon={<Icon name={icon} />}
                key={format}
                onClick={() =>
                  runCommand(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format))
                }
                shortcut={shortcut}
              >
                {t(labelKey, label)}
              </ContextMenu.Item>
            ))}
            <ContextMenu.Item
              className={cn(info.linkUrl && ACTIVE)}
              icon={<Icon name="link" />}
              onClick={openLink}
              shortcut="Ctrl+K"
            >
              {t('format.link', 'Ссылка')}
            </ContextMenu.Item>
            <ContextMenu.Item
              className={cn(info.quote && ACTIVE)}
              icon={<Icon name="quote" />}
              onClick={toggleQuote}
            >
              {t('format.quote', 'Цитата')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item icon={<Icon name="clearFormatting" />} onClick={clearFormatting}>
              {t('format.plain', 'Обычный текст')}
            </ContextMenu.Item>
          </>
        ) : (
          <>
            <ContextMenu.Item
              icon={<Icon name="undo" />}
              onClick={() => runCommand(() => editor.dispatchCommand(UNDO_COMMAND, undefined))}
              shortcut="Ctrl+Z"
            >
              {t('editMenu.undo', 'Отменить')}
            </ContextMenu.Item>
            <ContextMenu.Item
              icon={<Icon name="redo" />}
              onClick={() => runCommand(() => editor.dispatchCommand(REDO_COMMAND, undefined))}
              shortcut="Ctrl+Shift+Z"
            >
              {t('editMenu.redo', 'Повторить')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              icon={<Icon name="scissors" />}
              disabled={!info.hasText}
              onClick={() => {
                void navigator.clipboard?.writeText(selectedText());
                run(removeSelected);
              }}
              shortcut="Ctrl+X"
            >
              {t('editMenu.cut', 'Вырезать')}
            </ContextMenu.Item>
            <ContextMenu.Item
              disabled={!info.hasText}
              icon={<Icon name="copy" />}
              onClick={() => {
                void navigator.clipboard?.writeText(selectedText());
                close();
                restore();
              }}
              shortcut="Ctrl+C"
            >
              {t('editMenu.copy', 'Копировать')}
            </ContextMenu.Item>
            <ContextMenu.Item
              icon={<Icon name="paste" />}
              disabled={!canPaste}
              onClick={() => {
                close();
                void navigator.clipboard.readText().then((text) =>
                  run(() => {
                    const selection = $getSelection();
                    if ($isRangeSelection(selection)) selection.insertRawText(text);
                  })
                );
              }}
              shortcut="Ctrl+V"
            >
              {t('editMenu.paste', 'Вставить')}
            </ContextMenu.Item>
            <ContextMenu.Item
              disabled={!info.hasText}
              icon={<Icon name="trash" />}
              onClick={() => run(removeSelected)}
            >
              {t('editMenu.delete', 'Удалить')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              icon={<Icon name="selectAll" />}
              onClick={() => {
                close();
                editor.focus();
                editor.update(() => {
                  $getRoot().select(0, $getRoot().getChildrenSize());
                });
              }}
              shortcut="Ctrl+A"
            >
              {t('editMenu.selectAll', 'Выделить всё')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              disabled={!info.hasText}
              icon={<Icon name="type" />}
              onClick={() => menu && setMenu({ ...menu, view: 'format' })}
            >
              <span className="flex items-center justify-between gap-2">
                {t('format.menu', 'Форматирование')}
                <Icon className="size-4 text-ink-3" name="chevronRight" />
              </span>
            </ContextMenu.Item>
          </>
        )}
      </ContextMenu>
      {linkDialog && (
        <LinkDialog
          initialUrl={linkDialog.url}
          onApply={applyLink}
          onCancel={() => {
            setLinkDialog(null);
            restore();
          }}
          onRemove={() => applyLink(null)}
          open
        />
      )}
    </>
  );
}
