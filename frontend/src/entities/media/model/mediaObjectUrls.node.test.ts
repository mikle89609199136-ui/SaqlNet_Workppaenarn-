import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMediaObjectUrls, resolveMediaObjectUrl } from './mediaObjectUrls';

/** Счётчики вместо настоящего браузерного реестра. */
let created: string[];
let revoked: string[];

function blobOf(size: number): Blob {
  return { size, type: 'image/png' } as Blob;
}

beforeEach(() => {
  created = [];
  revoked = [];
  let counter = 0;

  vi.stubGlobal('URL', {
    createObjectURL: () => {
      counter += 1;
      const url = `blob:test/${counter}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });
});

afterEach(() => {
  clearMediaObjectUrls();
  vi.unstubAllGlobals();
});

describe('реестр расшифрованного медиа', () => {
  it('should hand out one url per file', async () => {
    // Тот же файл запрашивается снова после перезапроса ленты: раньше
    // каждый такой запрос создавал новую копию, и она оставалась в памяти
    // навсегда — реакция собеседника дублировала все медиа чата.
    const first = await resolveMediaObjectUrl('/media/photo-1', async () => blobOf(1024));
    const second = await resolveMediaObjectUrl('/media/photo-1', async () => blobOf(1024));

    expect(second).toBe(first);
    expect(created).toHaveLength(1);
  });

  it('should decrypt only once for the same file', async () => {
    const decrypt = vi.fn(async () => blobOf(1024));

    await resolveMediaObjectUrl('/media/photo-2', decrypt);
    await resolveMediaObjectUrl('/media/photo-2', decrypt);

    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('should release the oldest files when the budget is exceeded', async () => {
    // Бюджет ограничен: без него реестр сам стал бы утечкой, только
    // упорядоченной.
    const megabyte = 1024 * 1024;

    const first = await resolveMediaObjectUrl('/media/a', async () => blobOf(200 * megabyte));
    await resolveMediaObjectUrl('/media/b', async () => blobOf(200 * megabyte));

    expect(revoked).toContain(first);
  });

  it('should keep a file that was requested recently', async () => {
    const megabyte = 1024 * 1024;

    const first = await resolveMediaObjectUrl('/media/a', async () => blobOf(120 * megabyte));
    // Повторное обращение делает файл свежим.
    await resolveMediaObjectUrl('/media/a', async () => blobOf(120 * megabyte));
    await resolveMediaObjectUrl('/media/b', async () => blobOf(120 * megabyte));

    expect(revoked).not.toContain(first);
  });

  it('should release everything when the session ends', async () => {
    // Расшифрованные файлы не должны достаться следующему, кто войдёт
    // в этой вкладке.
    const a = await resolveMediaObjectUrl('/media/a', async () => blobOf(1024));
    const b = await resolveMediaObjectUrl('/media/b', async () => blobOf(1024));

    clearMediaObjectUrls();

    expect(revoked).toEqual(expect.arrayContaining([a, b]));
  });

  it('should not cache a failed decryption', async () => {
    await expect(
      resolveMediaObjectUrl('/media/broken', async () => {
        throw new Error('не удалось расшифровать');
      })
    ).rejects.toThrow();

    const second = await resolveMediaObjectUrl('/media/broken', async () => blobOf(1024));

    expect(second).toBe(created[0]);
  });
});
