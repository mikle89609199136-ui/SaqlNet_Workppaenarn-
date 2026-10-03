import { testI18n } from '@/test/harness/i18n';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { RichTextInput } from './RichTextInput';

/* Вставка файлов (скриншоты, скопированные изображения) из буфера обмена (#891). */
describe('RichTextInput.paste', () => {
  it('вызывает onPasteFiles при вставке файла/изображения без текста', () => {
    const onPasteFiles = vi.fn().mockReturnValue(true);
    render(
      <I18nextProvider i18n={testI18n}>
        <RichTextInput ariaLabel="Сообщение" onPasteFiles={onPasteFiles} />
      </I18nextProvider>
    );

    const textbox = screen.getByRole('textbox', { name: 'Сообщение' });
    const file = new File(['content'], 'screenshot.png', { type: 'image/png' });

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [file],
        types: ['Files'],
        getData: (format: string) => (format === 'text/plain' ? '' : ''),
      },
    });

    textbox.dispatchEvent(pasteEvent);

    expect(onPasteFiles).toHaveBeenCalledWith([file]);
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it('не вызывает onPasteFiles при смешанной вставке с текстом (приоритет у текста)', () => {
    const onPasteFiles = vi.fn().mockReturnValue(true);
    render(
      <I18nextProvider i18n={testI18n}>
        <RichTextInput ariaLabel="Сообщение" onPasteFiles={onPasteFiles} />
      </I18nextProvider>
    );

    const textbox = screen.getByRole('textbox', { name: 'Сообщение' });
    const file = new File(['content'], 'image.png', { type: 'image/png' });

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [file],
        types: ['text/plain', 'Files'],
        getData: (format: string) => (format === 'text/plain' ? 'Текст статьи' : ''),
      },
    });

    textbox.dispatchEvent(pasteEvent);

    expect(onPasteFiles).not.toHaveBeenCalled();
  });

  it('не отменяет событие, если onPasteFiles вернул false', () => {
    const onPasteFiles = vi.fn().mockReturnValue(false);
    render(
      <I18nextProvider i18n={testI18n}>
        <RichTextInput ariaLabel="Сообщение" onPasteFiles={onPasteFiles} />
      </I18nextProvider>
    );

    const textbox = screen.getByRole('textbox', { name: 'Сообщение' });
    const file = new File(['content'], 'screenshot.png', { type: 'image/png' });

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [file],
        types: ['Files'],
        getData: () => '',
      },
    });

    textbox.dispatchEvent(pasteEvent);

    expect(onPasteFiles).toHaveBeenCalledWith([file]);
    expect(pasteEvent.defaultPrevented).toBe(false);
  });
});
