import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { services } from '@/services/serviceContainer';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

describe('MediaService: upload', () => {
  it('should post file to /media and return upload data with url', async () => {
    let capturedMethod = '';
    let capturedContentType = '';

    server.use(
      http.post(api('/media'), async ({ request }) => {
        capturedMethod = request.method;
        capturedContentType = request.headers.get('content-type') || '';
        return HttpResponse.json(
          {
            success: true,
            url: '/api/v2/media/test-upload-id',
            fileName: 'avatar.png',
            sizeBytes: 1234,
            contentType: 'image/png',
          },
          { status: 201 }
        );
      })
    );

    const file = new File(['dummy content'], 'avatar.png', { type: 'image/png' });
    const result = await services.mediaService.upload(file);

    expect(capturedMethod).toBe('POST');
    // fetch with FormData produces multipart/form-data
    expect(capturedContentType).toContain('multipart/form-data');
    expect(result.url).toBe('/api/v2/media/test-upload-id');
    expect(result.success).toBe(true);
  });

  it('should preserve the root error code when an upload is too large', async () => {
    server.use(
      http.post(api('/media'), () =>
        HttpResponse.json(
          {
            code: 'file_too_large',
            message: 'file exceeds 100 MB limit',
            requestId: 'media-upload-test',
          },
          { status: 413 }
        )
      )
    );

    const file = new File(['large content'], 'large.png', { type: 'image/png' });
    const failure = await services.mediaService.upload(file).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('file exceeds 100 MB limit');
    expect((failure as Error & { code?: string }).code).toBe('file_too_large');
  });
});

describe('MediaService: стикеры и гифки (#593)', () => {
  it('listStickerPacks запрашивает GET /stickers/packs', async () => {
    server.use(
      http.get(api('/stickers/packs'), () =>
        HttpResponse.json({
          packs: [
            {
              id: 'pack-1',
              name: 'Котики',
              description: 'Милые котики',
              iconUrl: 'http://icon',
              stickerCount: 5,
              createdAt: '2026-01-01',
            },
          ],
        })
      )
    );

    const packs = await services.mediaService.listStickerPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].name).toBe('Котики');
  });

  it('listStickers запрашивает GET /stickers/packs/:packId', async () => {
    server.use(
      http.get(api('/stickers/packs/pack-1'), () =>
        HttpResponse.json({
          stickers: [
            { id: 's-1', imageUrl: 'http://s1.png', createdAt: '2026-01-01' },
            { id: 's-2', imageUrl: 'http://s2.png', createdAt: '2026-01-01' },
          ],
        })
      )
    );

    const stickers = await services.mediaService.listStickers('pack-1');
    expect(stickers).toHaveLength(2);
    expect(stickers[0].imageUrl).toBe('http://s1.png');
  });

  it('listGifs и listFavoriteGifs запрашивают /gifs и /gifs/favorites', async () => {
    server.use(
      http.get(api('/gifs'), () =>
        HttpResponse.json({
          gifs: [{ id: 'g-1', name: 'wave', url: 'http://g1.gif', userName: 'u1', createdAt: '2026' }],
        })
      ),
      http.get(api('/gifs/favorites'), () =>
        HttpResponse.json({
          gifs: [{ id: 'g-fav', name: 'dance', url: 'http://g2.gif', userName: 'u1', createdAt: '2026' }],
        })
      )
    );

    const allGifs = await services.mediaService.listGifs();
    const favGifs = await services.mediaService.listFavoriteGifs();
    expect(allGifs[0].name).toBe('wave');
    expect(favGifs[0].name).toBe('dance');
  });

  it('favoriteGif и unfavoriteGif вызывают POST и DELETE /gifs/:gifId/favorite', async () => {
    let postCalled = false;
    let deleteCalled = false;

    server.use(
      http.post(api('/gifs/g-1/favorite'), () => {
        postCalled = true;
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
      http.delete(api('/gifs/g-1/favorite'), () => {
        deleteCalled = true;
        return HttpResponse.json({ success: true });
      })
    );

    await services.mediaService.favoriteGif('g-1');
    await services.mediaService.unfavoriteGif('g-1');
    expect(postCalled).toBe(true);
    expect(deleteCalled).toBe(true);
  });
});
