import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import {
  $getRoot,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  FORMAT_TEXT_COMMAND,
} from 'lexical';
import { $insertDataTransferForRichText } from '@lexical/clipboard';
import { describe, expect, it } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { composerEditor, typeIntoComposer } from '@/test/harness/composer';
import { RichTextInput, type IRichTextInputHandle } from './RichTextInput';

function renderInput() {
  const handle = createRef<IRichTextInputHandle>();
  render(
    <I18nextProvider i18n={testI18n}>
      <RichTextInput ariaLabel="Сообщение" ref={handle} />
    </I18nextProvider>
  );
  return { handle, field: screen.getByRole('textbox', { name: 'Сообщение' }) };
}

describe('комбинированное форматирование в поле ввода (#915, #656)', () => {
  it('одновременное подчёркивание и зачёркивание применяет класс [text-decoration-line:underline_line-through]', async () => {
    const { field, handle } = renderInput();

    await typeIntoComposer(field, {
      text: 'комбо',
      entities: [
        { type: 'underline', offset: 0, length: 5 },
        { type: 'strikethrough', offset: 0, length: 5 },
      ],
    });

    const span = field.querySelector('span');
    expect(span).toBeInTheDocument();
    expect(span).toHaveClass('[text-decoration-line:underline_line-through]');
    expect(span).not.toHaveClass('line-through');
    expect(span).not.toHaveClass('underline');

    expect(handle.current?.getValue().entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'underline', offset: 0, length: 5 }),
        expect.objectContaining({ type: 'strikethrough', offset: 0, length: 5 }),
      ])
    );
  });

  it('комбинирует все стили одновременно в поле ввода (жирный + курсив + подчёркнутый + зачёркнутый)', async () => {
    const { field, handle } = renderInput();

    await typeIntoComposer(field, {
      text: 'полный набор',
      entities: [
        { type: 'bold', offset: 0, length: 12 },
        { type: 'italic', offset: 0, length: 12 },
        { type: 'underline', offset: 0, length: 12 },
        { type: 'strikethrough', offset: 0, length: 12 },
      ],
    });

    const el = screen.getByText('полный набор');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('font-semibold');
    expect(el).toHaveClass('italic');
    expect(el).toHaveClass('[text-decoration-line:underline_line-through]');

    expect(handle.current?.getValue().entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'bold', offset: 0, length: 12 }),
        expect.objectContaining({ type: 'italic', offset: 0, length: 12 }),
        expect.objectContaining({ type: 'underline', offset: 0, length: 12 }),
        expect.objectContaining({ type: 'strikethrough', offset: 0, length: 12 }),
      ])
    );
  });

  it('последовательное применение нескольких стилей не затирает предыдущие', async () => {
    const { field, handle } = renderInput();
    const editor = composerEditor(field);

    await typeIntoComposer(field, 'текст');

    await act(async () => {
      editor.update(
        () => {
          const paragraph = $getRoot().getFirstChild();
          const textNode = $isElementNode(paragraph) ? paragraph.getFirstChild() : null;
          if ($isTextNode(textNode)) textNode.select(0, 5);
        },
        { discrete: true }
      );
    });

    // Применяем подряд жирный, курсив, подчёркивание и зачёркивание
    await act(async () => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough');
    });

    const val = handle.current?.getValue();
    expect(val?.text).toBe('текст');
    expect(val?.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'bold', offset: 0, length: 5 }),
        expect.objectContaining({ type: 'italic', offset: 0, length: 5 }),
        expect.objectContaining({ type: 'underline', offset: 0, length: 5 }),
        expect.objectContaining({ type: 'strikethrough', offset: 0, length: 5 }),
      ])
    );

    const el = screen.getByText('текст');
    expect(el).toHaveClass('font-semibold');
    expect(el).toHaveClass('italic');
    expect(el).toHaveClass('[text-decoration-line:underline_line-through]');
  });

  it('комбинирует спойлер с зачёркиванием и подчёркиванием без взаимного затирания', async () => {
    const { field, handle } = renderInput();

    await typeIntoComposer(field, {
      text: 'секрет',
      entities: [
        { type: 'spoiler', offset: 0, length: 6 },
        { type: 'underline', offset: 0, length: 6 },
        { type: 'strikethrough', offset: 0, length: 6 },
      ],
    });

    const el = screen.getByText('секрет');
    expect(el).toHaveClass('[text-decoration-line:underline_line-through]');
    expect(el).toHaveClass('border-b');
    expect(el).toHaveClass('border-dotted');

    expect(handle.current?.getValue().entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'spoiler', offset: 0, length: 6 }),
        expect.objectContaining({ type: 'underline', offset: 0, length: 6 }),
        expect.objectContaining({ type: 'strikethrough', offset: 0, length: 6 }),
      ])
    );
  });

  it('вставка HTML с зачёркнутым скрытым текстом и ссылкой сохраняет все сущности (#915)', async () => {
    const { field, handle } = renderInput();
    const editor = composerEditor(field);

    const html = '<mark><s>секрет</s></mark> и <a href="https://example.com">ссылка</a>';
    const text = 'секрет и ссылка';

    const dt = {
      getData: (mime: string) => (mime === 'text/html' ? html : mime === 'text/plain' ? text : ''),
      types: ['text/html', 'text/plain'],
    };

    await act(async () => {
      editor.update(
        () => {
          const selection = $getRoot().selectStart();
          if ($isRangeSelection(selection)) {
            $insertDataTransferForRichText(dt as unknown as DataTransfer, selection);
          }
        },
        { discrete: true }
      );
    });

    const val = handle.current?.getValue();
    expect(val?.text).toBe('секрет и ссылка');
    expect(val?.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'strikethrough', offset: 0, length: 6 }),
        expect.objectContaining({ type: 'spoiler', offset: 0, length: 6 }),
        expect.objectContaining({
          type: 'link',
          offset: 9,
          length: 6,
          data: { url: 'https://example.com' },
        }),
      ])
    );
  });

  describe('вставка из Google Docs, Word и веб-страниц (#966)', () => {
    async function paste(field: HTMLElement, html: string, text: string) {
      const editor = composerEditor(field);
      const data = {
        getData: (mime: string) =>
          mime === 'text/html' ? html : mime === 'text/plain' ? text : '',
        types: ['text/html', 'text/plain'],
      };
      await act(async () => {
        editor.update(
          () => {
            const selection = $getRoot().selectStart();
            if ($isRangeSelection(selection)) {
              $insertDataTransferForRichText(data as unknown as DataTransfer, selection);
            }
          },
          { discrete: true }
        );
      });
    }

    const textNode = (field: HTMLElement, text: string) =>
      Array.from(field.querySelectorAll('[data-lexical-text]')).find(
        (node) => node.textContent === text
      )!;

    it('стиль, попавший в текстовый узел, очищается, а формат остаётся', async () => {
      const { field, handle } = renderInput();
      const editor = composerEditor(field);
      await typeIntoComposer(field, {
        text: 'важно',
        entities: [{ type: 'bold', offset: 0, length: 5 }],
      });

      await act(async () => {
        editor.update(
          () => {
            const paragraph = $getRoot().getFirstChild();
            const node = $isElementNode(paragraph) ? paragraph.getFirstChild() : null;
            if ($isTextNode(node))
              node.setStyle('font-weight: 400; text-decoration: none; color: red;');
          },
          { discrete: true }
        );
      });

      expect(textNode(field, 'важно')).not.toHaveAttribute('style');
      expect(textNode(field, 'важно')).toHaveClass('font-semibold');
      expect(handle.current?.getValue().entities).toEqual([
        expect.objectContaining({ type: 'bold', offset: 0, length: 5 }),
      ]);
    });

    it('стили сброса источника не перебивают жирный и подчёркнутый в поле', async () => {
      const { field, handle } = renderInput();

      await paste(
        field,
        '<b style="font-weight:normal;"><span style="font-weight:700;text-decoration:underline;">важно</span>' +
          '<span style="font-weight:400;text-decoration:none;font-style:normal;"> обычный</span></b>',
        'важно обычный'
      );

      const bold = textNode(field, 'важно');
      expect(bold).toHaveClass('font-semibold', 'underline');
      expect(bold).not.toHaveAttribute('style');
      expect(textNode(field, ' обычный')).not.toHaveAttribute('style');
      expect(handle.current?.getValue()).toEqual({
        text: 'важно обычный',
        entities: expect.arrayContaining([
          expect.objectContaining({ type: 'bold', offset: 0, length: 5 }),
          expect.objectContaining({ type: 'underline', offset: 0, length: 5 }),
        ]),
      });
    });

    it('курсив и зачёркнутый из Word видны в поле, цвета и шрифты источника не переносятся', async () => {
      const { field, handle } = renderInput();

      await paste(
        field,
        '<p><i style="font-family:Calibri;color:#c00000;">курсив</i> ' +
          '<s style="text-decoration:none;color:red;">мимо</s></p>',
        'курсив мимо'
      );

      expect(textNode(field, 'курсив')).toHaveClass('italic');
      expect(textNode(field, 'мимо')).toHaveClass('line-through');
      expect(field.querySelectorAll('[style]')).toHaveLength(0);
      expect(handle.current?.getValue().entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'italic', offset: 0, length: 6 }),
          expect.objectContaining({ type: 'strikethrough', offset: 7, length: 4 }),
        ])
      );
    });
  });
});
