import { act, renderHook } from '@testing-library/react';
import { useState, type ChangeEvent } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { testI18n } from '@/test/harness/i18n';
import type { IPendingAttachment } from '@/types';
import {
  formatScreenshotName,
  MAX_ATTACHMENT_BYTES,
  MAX_PENDING_ATTACHMENTS,
  useAttachmentPicker,
} from './useAttachmentPicker';

function fileOf(name: string, type = 'image/png', size = 10) {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function renderPicker(initial: IPendingAttachment[] = []) {
  const input = document.createElement('input');
  const attachmentInputRef = { current: input };
  const view = renderHook(
    () => {
      const [pendingAttachments, setPendingAttachments] = useState(initial);
      return {
        pendingAttachments,
        ...useAttachmentPicker({ pendingAttachments, setPendingAttachments, attachmentInputRef }),
      };
    },
    { wrapper: ({ children }) => <I18nextProvider i18n={testI18n}>{children}</I18nextProvider> }
  );

  const pick = (...files: File[]) => {
    const target = { files, value: 'C:\\fakepath\\x' };
    act(() => {
      view.result.current.handleAttachmentChange({
        target,
      } as unknown as ChangeEvent<HTMLInputElement>);
    });
    return target;
  };
  return { ...view, pick, input };
}

const names = (attachments: IPendingAttachment[]) => attachments.map((a) => a.file.name);

beforeEach(() => {
  useChatUiStore.setState({ error: '', editingMessage: null });
});

/* Выбор вложений (#171): добавляется, а не заменяет. */
describe('выбор вложений', () => {
  it('новый файл добавляется к приложенному, а не заменяет его', () => {
    const { result, pick } = renderPicker();
    pick(fileOf('a.png'));
    pick(fileOf('b.pdf', 'application/pdf'));

    expect(names(result.current.pendingAttachments)).toEqual(['a.png', 'b.pdf']);
    expect(result.current.pendingAttachments.map((a) => a.type)).toEqual(['image', 'file']);
  });

  it('несколько файлов за раз; поле сбрасывается — тот же файл можно выбрать снова', () => {
    const { result, pick } = renderPicker();
    const same = fileOf('same.png');
    const target = pick(same, fileOf('video.mp4', 'video/mp4'));
    expect(target.value).toBe('');
    pick(same);

    expect(names(result.current.pendingAttachments)).toEqual(['same.png', 'video.mp4', 'same.png']);
    // Ключи разные — дубли не склеиваются в списке.
    const ids = result.current.pendingAttachments.map((a) => a.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('крестик убирает только своё вложение', () => {
    const { result, pick } = renderPicker();
    pick(fileOf('a.png'), fileOf('b.png'), fileOf('c.png'));
    const middle = result.current.pendingAttachments[1]!.id;

    act(() => result.current.removePendingAttachment(middle));
    expect(names(result.current.pendingAttachments)).toEqual(['a.png', 'c.png']);
  });

  it('больше 100 МБ — не прикладывается, остальные — да, с объяснением', () => {
    const { result, pick } = renderPicker();
    pick(fileOf('big.mp4', 'video/mp4', MAX_ATTACHMENT_BYTES + 1), fileOf('ok.png'));

    expect(names(result.current.pendingAttachments)).toEqual(['ok.png']);
    expect(useChatUiStore.getState().error).toMatch(/100 МБ/);
  });

  it('сверх десяти — не прикладывается, с объяснением', () => {
    const { result, pick } = renderPicker();
    const files = Array.from({ length: MAX_PENDING_ATTACHMENTS - 1 }, (_, i) => fileOf(`${i}.png`));
    pick(...files);
    pick(fileOf('tenth.png'), fileOf('eleventh.png'));

    expect(result.current.pendingAttachments).toHaveLength(MAX_PENDING_ATTACHMENTS);
    expect(names(result.current.pendingAttachments)).not.toContain('eleventh.png');
    expect(useChatUiStore.getState().error).toBe('Можно приложить не больше 10 файлов');
  });

  it('выбор без файлов (отмена диалога) ничего не меняет', () => {
    const { result, pick } = renderPicker();
    pick(fileOf('a.png'));
    pick();
    expect(names(result.current.pendingAttachments)).toEqual(['a.png']);
  });

  it('addFiles переименовывает скриншоты image.png, image.webp или без имени в Снимок YYYY-MM-DD HH-mm-ss', () => {
    const { result } = renderPicker();
    const screenshot = fileOf('image.png', 'image/png');
    const genericWebp = fileOf('image.webp', 'image/webp');
    const unnamedJpeg = fileOf('', 'image/jpeg');
    const realName = fileOf('my-photo.jpg', 'image/jpeg');

    act(() => {
      const added = result.current.addFiles([screenshot, genericWebp, unnamedJpeg, realName]);
      expect(added).toBe(true);
    });

    const addedNames = names(result.current.pendingAttachments);
    expect(addedNames[0]).toMatch(/^Снимок \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/);
    expect(addedNames[1]).toMatch(/^Снимок \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.webp$/);
    expect(addedNames[2]).toMatch(/^Снимок \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.jpg$/);
    expect(addedNames[3]).toBe('my-photo.jpg');
  });

  it('addFiles с пустым списком возвращает false', () => {
    const { result } = renderPicker();
    let added = false;
    act(() => {
      added = result.current.addFiles([]);
    });
    expect(added).toBe(false);
    expect(result.current.pendingAttachments).toHaveLength(0);
  });

  it('formatScreenshotName поддерживает кастомный префикс (локализация)', () => {
    const fixedDate = new Date(2026, 8, 29, 12, 30, 45);
    expect(formatScreenshotName(fixedDate, 'image/png', 'Screenshot')).toBe(
      'Screenshot 2026-09-29 12-30-45.png'
    );
  });
});
