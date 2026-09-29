import { describe, expect, it, vi } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import type { IMediaItem } from '@/types';
import { canCopyImageToClipboard, copyImageToClipboard, mediaFileName } from './mediaActions';

const at = new Date(2026, 8, 29, 21, 5);
const media = (extra: Partial<IMediaItem>) =>
  makeMessage({ createdAt: at, content: '', ...extra } as never) as IMediaItem;

describe('имя файла для «Сохранить как…» (#655)', () => {
  it('исходное имя из шифрованного конверта', () => {
    const message = media({
      type: 'file',
      mediaEncryption: { fileName: 'отчёт.pdf', mimeType: 'application/pdf' } as never,
    });
    expect(mediaFileName(message)).toBe('отчёт.pdf');
  });

  it('без имени — по типу и времени, расширение по MIME', () => {
    expect(
      mediaFileName(media({ type: 'image', mediaEncryption: { mimeType: 'image/png' } as never }))
    ).toBe('photo-2026-09-29-2105.png');
    expect(
      mediaFileName(media({ type: 'video', mediaEncryption: { mimeType: 'video/webm' } as never }))
    ).toBe('video-2026-09-29-2105.webm');
  });

  it('голосовое — voice-<дата>.ogg, даже если имя пришло', () => {
    const message = media({
      type: 'voice',
      mediaEncryption: { mimeType: 'audio/ogg; codecs=opus', fileName: 'x' } as never,
    });
    expect(mediaFileName(message)).toBe('voice-2026-09-29-2105.ogg');
  });

  it('неизвестный тип — расширение по виду вложения', () => {
    expect(mediaFileName(media({ type: 'image' }))).toBe('photo-2026-09-29-2105.jpg');
  });
});

describe('картинка в буфер обмена', () => {
  it('кладёт PNG, переданный обещанием (Safari требует записи внутри нажатия)', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const write = vi.fn().mockResolvedValue(undefined);
    const items: Record<string, unknown>[] = [];
    class FakeItem {
      constructor(data: Record<string, unknown>) {
        items.push(data);
      }
    }

    await copyImageToClipboard('blob:photo', {
      clipboard: { write },
      ClipboardItemCtor: FakeItem as never,
      renderPng: async (url) => {
        expect(url).toBe('blob:photo');
        return png;
      },
    });

    expect(write).toHaveBeenCalledOnce();
    expect(items[0]['image/png']).toBeInstanceOf(Promise);
    await expect(items[0]['image/png']).resolves.toBe(png);
  });

  it('отказ буфера доходит до вызывающего — там показывается ошибка', async () => {
    await expect(
      copyImageToClipboard('blob:photo', {
        clipboard: { write: vi.fn().mockRejectedValue(new Error('denied')) },
        ClipboardItemCtor: class {} as never,
        renderPng: async () => new Blob(),
      })
    ).rejects.toThrow('denied');
  });

  it('поддержка: нет ClipboardItem или write — пункта нет; supports решает за PNG', () => {
    expect(canCopyImageToClipboard({ clipboard: {}, ClipboardItemCtor: undefined })).toBe(false);
    expect(canCopyImageToClipboard({ clipboard: {}, ClipboardItemCtor: class {} as never })).toBe(
      false
    );
    const withSupports = Object.assign(class {}, {
      supports: (type: string) => type === 'image/png',
    });
    expect(
      canCopyImageToClipboard({
        clipboard: { write: vi.fn() },
        ClipboardItemCtor: withSupports as never,
      })
    ).toBe(true);
  });
});
