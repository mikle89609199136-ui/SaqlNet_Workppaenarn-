import { describe, expect, it, vi } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import type { IMediaItem } from '@/types';
import {
  canCopyImageToClipboard,
  copyImageToClipboard,
  mediaFileName,
  saveMedia,
} from './mediaActions';

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

    await copyImageToClipboard('blob:photo', '', {
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
      copyImageToClipboard('blob:photo', '', {
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

describe('копирование фото с подписью', () => {
  it('подпись ложится рядом с картинкой как текст', async () => {
    const items: Record<string, unknown>[] = [];
    await copyImageToClipboard('blob:photo', 'закат', {
      clipboard: { write: vi.fn().mockResolvedValue(undefined) },
      ClipboardItemCtor: class {
        constructor(data: Record<string, unknown>) {
          items.push(data);
        }
      } as never,
      renderPng: async () => new Blob(['png'], { type: 'image/png' }),
    });

    expect(Object.keys(items[0]).sort()).toEqual(['image/png', 'text/plain']);
    await expect((items[0]['text/plain'] as Blob).text()).resolves.toBe('закат');
  });
});

describe('«Сохранить как…» (#655)', () => {
  const blob = new Blob(['pdf'], { type: 'application/pdf' });

  it('окно выбора места: исходное имя, файл записан', async () => {
    const written: Blob[] = [];
    const picker = vi.fn().mockResolvedValue({
      createWritable: async () => ({
        write: async (data: Blob) => void written.push(data),
        close: async () => {},
      }),
    });
    const download = vi.fn();

    const result = await saveMedia('blob:file', 'договор.pdf', {
      picker,
      blobByUrl: () => blob,
      download,
    });

    expect(result).toBe('saved');
    expect(picker).toHaveBeenCalledWith({
      suggestedName: 'договор.pdf',
      types: [{ accept: { 'application/pdf': ['.pdf'] } }],
    });
    expect(written).toEqual([blob]);
    expect(download).not.toHaveBeenCalled();
  });

  it('человек закрыл окно — не ошибка и не скачивание', async () => {
    const download = vi.fn();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });

    const result = await saveMedia('blob:file', 'договор.pdf', {
      picker: vi.fn().mockRejectedValue(abort),
      blobByUrl: () => blob,
      download,
    });

    expect(result).toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });

  it('окна нет (Firefox, Safari, телефон) или файл уже отпущен — обычное скачивание', async () => {
    const download = vi.fn();
    await expect(
      saveMedia('blob:file', 'a.pdf', { picker: null, blobByUrl: () => blob, download })
    ).resolves.toBe('downloaded');
    await expect(
      saveMedia('blob:file', 'b.pdf', { picker: vi.fn(), blobByUrl: () => undefined, download })
    ).resolves.toBe('downloaded');
    expect(download.mock.calls).toEqual([
      ['blob:file', 'a.pdf'],
      ['blob:file', 'b.pdf'],
    ]);
  });
});
