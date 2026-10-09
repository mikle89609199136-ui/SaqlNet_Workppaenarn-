import { forwardRef, useEffect, useImperativeHandle } from 'react';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type EditorThemeClasses,
} from 'lexical';
import { LinkNode } from '@lexical/link';
import { QuoteNode } from '@lexical/rich-text';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { isSafeLinkUrl, type IRichText } from '@/shared/lib/richText';
import { cn } from '@/shared/lib';
import { ComposerContextMenu } from './ComposerContextMenu';
import { matchFormatShortcut } from './formatShortcuts';
import { $readRichText, $writeRichText } from './lexicalRichText';

/**
 * Поле ввода с форматированием (#656): жирный, курсив, подчёркнутый,
 * зачёркнутый, спойлер, моноширинный, ссылка и цитата.
 *
 * Снаружи — «ручка» вместо DOM-элемента: текст с диапазонами читается и
 * пишется целиком, а не через `value`. Enter отправляет, Shift+Enter —
 * новая строка. Форматирование — в контекстном меню (правый клик).
 */
export interface IRichTextInputHandle {
  getValue(): IRichText;
  setValue(value: IRichText | string): void;
  focus(): void;
  clear(): void;
  /** Вставить текст на место курсора (эмодзи из панели, #824). */
  insertText(text: string): void;
  contains(node: Node | null): boolean;
}

interface Props {
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Вставка файлов из буфера обмена (#891). Возвращает true, если файлы приняты.
   */
  onPasteFiles?: (files: File[]) => boolean;
  /**
   * Изменилось содержимое. `external` — записано программой (черновик,
   * правка, очистка), а не набрано человеком.
   */
  onChange?: (value: IRichText, meta: { external: boolean }) => void;
  /** Enter без Shift. */
  onSubmit?: () => void;
}

/* Классы для узлов редактора. Спойлер в редакторе не прячется — его надо
   видеть, пока пишешь, — а только помечается. */
const theme: EditorThemeClasses = {
  paragraph: 'm-0',
  quote: 'm-0 border-l-2 border-brand pl-2 text-ink-2',
  link: 'text-brand underline',
  text: {
    bold: 'font-semibold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: '[text-decoration-line:underline_line-through]',
    code: 'font-mono text-[0.92em] bg-sheet-2 rounded px-1',
    highlight: 'rounded bg-sheet-2 text-ink-2 border-b border-dotted border-current',
  },
};

const EMPTY: IRichText = { text: '', entities: [] };

/** Метка программной записи: её не считают набором текста. */
const EXTERNAL = 'external-write';

function HandlePlugin({ handleRef }: { handleRef: React.Ref<IRichTextInputHandle> }) {
  const [editor] = useLexicalComposerContext();

  useImperativeHandle(
    handleRef,
    () => ({
      getValue: () => editor.getEditorState().read($readRichText),
      contains: (node) => Boolean(node && editor.getRootElement()?.contains(node)),
      setValue: (value) =>
        // discrete — чтобы сразу после записи чтение видело новое значение.
        editor.update(
          () => {
            $writeRichText(typeof value === 'string' ? { text: value, entities: [] } : value);
            $getRoot().selectEnd();
          },
          { discrete: true, tag: EXTERNAL }
        ),
      focus: () => editor.focus(),
      insertText: (text) =>
        // Курсор редактор помнит и без фокуса; если его не было — в конец.
        editor.update(() => {
          let selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            $getRoot().selectEnd();
            selection = $getSelection();
          }
          if ($isRangeSelection(selection)) selection.insertText(text);
        }),
      clear: () =>
        editor.update(
          () => {
            const root = $getRoot();
            root.clear();
            root.append($createParagraphNode());
          },
          { discrete: true, tag: EXTERNAL }
        ),
    }),
    [editor]
  );

  return null;
}

function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!disabled), [editor, disabled]);
  return null;
}

/** Enter — отправить, Shift+Enter — новая строка (отдельный абзац). */
function EnterPlugin({ onSubmit }: { onSubmit?: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          // Набор через IME: Enter подтверждает слово, а не отправляет.
          if (event?.isComposing) return false;
          event?.preventDefault();
          if (event?.shiftKey) {
            editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
          } else {
            onSubmit?.();
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor, onSubmit]
  );

  return null;
}

/**
 * Сочетания, которых нет в самом Lexical: жирный, курсив и подчёркнутый он
 * обрабатывает сам (Ctrl+B/I/U), ссылку (Ctrl+K) — контекстное меню.
 */
function ShortcutsPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          const format = matchFormatShortcut(event);
          if (!format) return false;
          event.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor]
  );

  return null;
}

/**
 * Вставка файлов (скриншоты, картинки) из буфера обмена (#891).
 * Если в буфере есть осмысленный текст (text/plain) — приоритет у текста,
 * чтобы не перехватывать копирование фрагментов страниц с картинками.
 */
function PasteFilesPlugin({ onPasteFiles }: { onPasteFiles?: (files: File[]) => boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onPasteFiles) return;

    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData =
          event && typeof event === 'object' && 'clipboardData' in event
            ? (event as { clipboardData: DataTransfer | null }).clipboardData
            : null;
        if (!clipboardData) return false;

        const files = Array.from(clipboardData.files ?? []);
        if (files.length === 0) return false;

        const plainText = clipboardData.getData('text/plain');
        if (plainText && plainText.trim().length > 0) {
          return false;
        }

        const handled = onPasteFiles(files);
        if (handled) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, onPasteFiles]);

  return null;
}

export const RichTextInput = forwardRef<IRichTextInputHandle, Props>(function RichTextInput(
  { ariaLabel, placeholder, disabled = false, className, onPasteFiles, onChange, onSubmit },
  ref
) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'message-composer',
        theme,
        nodes: [QuoteNode, LinkNode],
        onError: (error) => {
          console.error(error);
        },
      }}
    >
      <div className="relative min-w-0 flex-1">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={ariaLabel}
              aria-multiline
              className={cn('outline-none whitespace-pre-wrap [overflow-wrap:anywhere]', className)}
              role="textbox"
            />
          }
          placeholder={
            placeholder ? (
              <div className="pointer-events-none absolute inset-x-2 top-2.25 truncate text-body leading-[22px] text-ink-3 select-none">
                {placeholder}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <LinkPlugin validateUrl={isSafeLinkUrl} />
      <HandlePlugin handleRef={ref} />
      <EditablePlugin disabled={disabled} />
      <EnterPlugin onSubmit={onSubmit} />
      <ShortcutsPlugin />
      <PasteFilesPlugin onPasteFiles={onPasteFiles} />
      {onChange && (
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(state, _editor, tags) =>
            onChange(state.read($readRichText) ?? EMPTY, { external: tags.has(EXTERNAL) })
          }
        />
      )}
      <ComposerContextMenu onPasteFiles={onPasteFiles} />
    </LexicalComposer>
  );
});
