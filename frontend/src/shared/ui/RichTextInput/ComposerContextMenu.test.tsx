import { act, createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { $getRoot, $isElementNode, $isTextNode, FORMAT_TEXT_COMMAND } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import type { IRichText } from '@/shared/lib/richText';
import { composerEditor, typeIntoComposer } from '@/test/harness/composer';
import { testI18n } from '@/test/harness/i18n';
import { RichTextInput, type IRichTextInputHandle } from './RichTextInput';

function renderInput(onPasteFiles?: (files: File[]) => boolean) {
  const handle = createRef<IRichTextInputHandle>();
  render(
    <I18nextProvider i18n={testI18n}>
      <RichTextInput ariaLabel="Сообщение" onPasteFiles={onPasteFiles} ref={handle} />
    </I18nextProvider>
  );
  return { handle, field: screen.getByRole('textbox', { name: 'Сообщение' }) };
}

/** Выделить [start, end) в первой строке. */
async function select(field: HTMLElement, start: number, end: number) {
  const editor = composerEditor(field);
  await act(async () => {
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        const text = $isElementNode(paragraph) ? paragraph.getFirstChild() : null;
        if ($isTextNode(text)) text.select(start, end);
      },
      { discrete: true }
    );
  });
}

async function setup(value: string | IRichText, start: number, end: number) {
  const view = renderInput();
  await typeIntoComposer(view.field, value);
  await select(view.field, start, end);
  fireEvent.contextMenu(view.field, { clientX: 20, clientY: 20 });
  return view;
}

describe('контекстное меню поля ввода (#656)', () => {
  it('правый клик открывает своё меню вместо системного', async () => {
    const { field } = await setup('привет', 0, 6);

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    field.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('menu', { name: 'Правка' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Отменить/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Выделить всё/ })).toBeInTheDocument();
  });

  it('жирный из «Форматирования» ложится на выделенное', async () => {
    const { handle } = await setup('привет мир', 0, 6);

    await userEvent.click(screen.getByRole('menuitem', { name: /Форматирование/ }));
    expect(screen.getByRole('menu', { name: 'Форматирование' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /Жирный/ }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(handle.current?.getValue()).toEqual({
      text: 'привет мир',
      entities: [{ type: 'bold', offset: 0, length: 6 }],
    });
  });

  it('без выделения форматировать нечего', async () => {
    await setup('привет', 3, 3);

    expect(screen.getByRole('menuitem', { name: /Форматирование/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /Вырезать/ })).toBeDisabled();
  });

  it('«Назад» возвращает к правке', async () => {
    await setup('привет', 0, 6);

    await userEvent.click(screen.getByRole('menuitem', { name: /Форматирование/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Назад/ }));

    expect(screen.getByRole('menu', { name: 'Правка' })).toBeInTheDocument();
  });

  it('ссылка спрашивается в окне и ставится на выделенное', async () => {
    const { handle } = await setup('см. доки', 4, 8);

    await userEvent.click(screen.getByRole('menuitem', { name: /Форматирование/ }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /Ссылка/ }));
    await userEvent.type(screen.getByLabelText('Адрес ссылки'), 'example.com/docs');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(handle.current?.getValue()).toEqual({
      text: 'см. доки',
      entities: [{ type: 'link', offset: 4, length: 4, data: { url: 'https://example.com/docs' } }],
    });
  });

  it('Ctrl+K открывает окно ссылки без меню', async () => {
    const view = renderInput();
    await typeIntoComposer(view.field, 'см. доки');
    await select(view.field, 4, 8);

    fireEvent.keyDown(view.field, { key: 'k', ctrlKey: true });

    expect(await screen.findByLabelText('Адрес ссылки')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('javascript: ссылкой не станет', async () => {
    const { handle } = await setup('нажми', 0, 5);

    await userEvent.click(screen.getByRole('menuitem', { name: /Форматирование/ }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /Ссылка/ }));
    await userEvent.type(screen.getByLabelText('Адрес ссылки'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(screen.getByText('Нужен адрес вида https://example.com')).toBeInTheDocument();
    expect(handle.current?.getValue().entities).toEqual([]);
  });

  it('«Обычный текст» снимает всё форматирование', async () => {
    const { handle } = await setup(
      {
        text: 'привет',
        entities: [
          { type: 'bold', offset: 0, length: 6 },
          { type: 'spoiler', offset: 0, length: 6 },
          { type: 'blockquote', offset: 0, length: 6 },
        ],
      },
      0,
      6
    );

    await userEvent.click(screen.getByRole('menuitem', { name: /Форматирование/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Обычный текст/ }));

    expect(handle.current?.getValue()).toEqual({ text: 'привет', entities: [] });
  });

  it('цитата делает строку цитатой', async () => {
    const { handle } = await setup('кто-то сказал', 0, 6);

    await userEvent.click(screen.getByRole('menuitem', { name: /Форматирование/ }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /Цитата/ }));

    expect(handle.current?.getValue().entities).toEqual([
      { type: 'blockquote', offset: 0, length: 13 },
    ]);
  });

  /* Выделение при нажатии Lexical берёт из DOM, а в jsdom его нет — поэтому
     проверяется, какое форматирование сочетание заказало. */
  it.each([
    ['зачёркнутый', { key: 'X', code: 'KeyX' }, 'strikethrough'],
    ['моноширинный', { key: 'M', code: 'KeyM' }, 'code'],
    ['скрытый', { key: 'H', code: 'KeyH' }, 'highlight'],
    ['зачёркнутый в русской раскладке', { key: 'Ч', code: 'KeyX' }, 'strikethrough'],
    ['скрытый в русской раскладке', { key: 'Р', code: 'KeyH' }, 'highlight'],
  ])('Ctrl+Shift — %s', (_name, keys, format) => {
    const { field } = renderInput();
    const dispatch = vi.spyOn(composerEditor(field), 'dispatchCommand');

    fireEvent.keyDown(field, { ...keys, ctrlKey: true, shiftKey: true });

    expect(dispatch).toHaveBeenCalledWith(FORMAT_TEXT_COMMAND, format);
  });

  it('Ctrl+Shift+P браузерное — поле его не перехватывает', () => {
    const { field } = renderInput();
    const dispatch = vi.spyOn(composerEditor(field), 'dispatchCommand');

    const notBlocked = fireEvent.keyDown(field, {
      key: 'P',
      code: 'KeyP',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(notBlocked).toBe(true);
    expect(dispatch).not.toHaveBeenCalledWith(FORMAT_TEXT_COMMAND, expect.anything());
  });

  it('Ctrl+K срабатывает и в русской раскладке', async () => {
    const view = renderInput();
    await typeIntoComposer(view.field, 'доки');
    await select(view.field, 0, 4);

    fireEvent.keyDown(view.field, { key: 'л', code: 'KeyK', ctrlKey: true });

    expect(await screen.findByLabelText('Адрес ссылки')).toBeInTheDocument();
  });

  it('вставка из контекстного меню читает картинку через clipboard.read и вызывает onPasteFiles', async () => {
    const onPasteFiles = vi.fn().mockReturnValue(true);
    const { field } = renderInput(onPasteFiles);

    const blob = new Blob(['image-bytes'], { type: 'image/png' });
    const mockClipboardItem = {
      types: ['image/png'],
      getType: vi.fn().mockResolvedValue(blob),
    };

    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        read: vi.fn().mockResolvedValue([mockClipboardItem]),
        readText: vi.fn().mockResolvedValue(''),
        writeText: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    try {
      fireEvent.contextMenu(field, { clientX: 20, clientY: 20 });
      const pasteItem = screen.getByRole('menuitem', { name: /Вставить/ });
      expect(pasteItem).not.toBeDisabled();

      await userEvent.click(pasteItem);

      expect(onPasteFiles).toHaveBeenCalledWith([expect.objectContaining({ type: 'image/png' })]);
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    }
  });

  it('не вызывает onPasteFiles при наличии непустого текста в clipboard.read (приоритет текста)', async () => {
    const onPasteFiles = vi.fn().mockReturnValue(true);
    const { field } = renderInput(onPasteFiles);

    const blob = new Blob(['image-bytes'], { type: 'image/png' });
    const textBlob = new Blob(['Текст из таблицы'], { type: 'text/plain' });
    const mockClipboardItem = {
      types: ['image/png', 'text/plain'],
      getType: vi
        .fn()
        .mockImplementation((type: string) =>
          Promise.resolve(type === 'image/png' ? blob : textBlob)
        ),
    };

    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        read: vi.fn().mockResolvedValue([mockClipboardItem]),
        readText: vi.fn().mockResolvedValue('Текст из таблицы'),
        writeText: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    try {
      fireEvent.contextMenu(field, { clientX: 20, clientY: 20 });
      const pasteItem = screen.getByRole('menuitem', { name: /Вставить/ });
      expect(pasteItem).not.toBeDisabled();

      await userEvent.click(pasteItem);

      expect(onPasteFiles).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    }
  });

  it('вставка скопированного изображения из браузера (image/png + text/html <img> без text/plain) передаёт файл в onPasteFiles (#915)', async () => {
    const onPasteFiles = vi.fn().mockReturnValue(true);
    const { field } = renderInput(onPasteFiles);

    const imageBlob = new Blob(['image-bytes'], { type: 'image/png' });
    const htmlBlob = new Blob(['<img src="https://example.com/pic.png">'], { type: 'text/html' });
    const mockClipboardItem = {
      types: ['image/png', 'text/html'],
      getType: vi
        .fn()
        .mockImplementation((type: string) =>
          Promise.resolve(type === 'image/png' ? imageBlob : htmlBlob)
        ),
    };

    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        read: vi.fn().mockResolvedValue([mockClipboardItem]),
        readText: vi.fn().mockResolvedValue(''),
        writeText: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    try {
      fireEvent.contextMenu(field, { clientX: 20, clientY: 20 });
      const pasteItem = screen.getByRole('menuitem', { name: /Вставить/ });
      expect(pasteItem).not.toBeDisabled();

      await userEvent.click(pasteItem);

      expect(onPasteFiles).toHaveBeenCalledTimes(1);
      const files = onPasteFiles.mock.calls[0][0] as File[];
      expect(files).toHaveLength(1);
      expect(files[0].type).toBe('image/png');
      expect(files[0].name).toMatch(/^pasted-\d+-0\.png$/);
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    }
  });

  it('вставка из контекстного меню с text/html сохраняет разметку (#915)', async () => {
    const { field, handle } = renderInput();

    const htmlBlob = new Blob(['<p><b>жирный</b> и <a href="https://example.com">ссылка</a></p>'], {
      type: 'text/html',
    });
    const textBlob = new Blob(['жирный и ссылка'], { type: 'text/plain' });
    const mockClipboardItem = {
      types: ['text/html', 'text/plain'],
      getType: vi
        .fn()
        .mockImplementation((type: string) =>
          Promise.resolve(type === 'text/html' ? htmlBlob : textBlob)
        ),
    };

    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        read: vi.fn().mockResolvedValue([mockClipboardItem]),
        readText: vi.fn().mockResolvedValue('жирный и ссылка'),
        writeText: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    try {
      fireEvent.contextMenu(field, { clientX: 20, clientY: 20 });
      const pasteItem = screen.getByRole('menuitem', { name: /Вставить/ });
      await userEvent.click(pasteItem);

      const val = handle.current?.getValue();
      expect(val?.text).toBe('жирный и ссылка');
      expect(val?.entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'bold', offset: 0, length: 6 }),
          expect.objectContaining({
            type: 'link',
            offset: 9,
            length: 6,
            data: { url: 'https://example.com' },
          }),
        ])
      );
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    }
  });

  it('вставка из буфера обмена зачёркнутого спойлера вместе со ссылкой сохраняет все форматы (#915)', async () => {
    const { field, handle } = renderInput();

    const htmlBlob = new Blob(
      ['<p><mark><s>секрет</s></mark> и <a href="https://example.com">ссылка</a></p>'],
      { type: 'text/html' }
    );
    const textBlob = new Blob(['секрет и ссылка'], { type: 'text/plain' });
    const mockClipboardItem = {
      types: ['text/html', 'text/plain'],
      getType: vi
        .fn()
        .mockImplementation((type: string) =>
          Promise.resolve(type === 'text/html' ? htmlBlob : textBlob)
        ),
    };

    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        read: vi.fn().mockResolvedValue([mockClipboardItem]),
        readText: vi.fn().mockResolvedValue('секрет и ссылка'),
        writeText: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    try {
      fireEvent.contextMenu(field, { clientX: 20, clientY: 20 });
      const pasteItem = screen.getByRole('menuitem', { name: /Вставить/ });
      await userEvent.click(pasteItem);

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
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    }
  });
});
