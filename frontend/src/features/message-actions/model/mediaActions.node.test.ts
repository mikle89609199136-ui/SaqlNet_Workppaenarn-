import { describe, expect, it, vi } from 'vitest';
import { canCopyImageToClipboard, copyImageToClipboard } from './mediaActions';

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
