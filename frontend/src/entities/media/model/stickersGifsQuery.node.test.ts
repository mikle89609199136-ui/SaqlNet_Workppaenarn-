import { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import {
  favoriteGifsQuery,
  gifsQuery,
  stickerPacksQuery,
  stickersQuery,
} from './stickersGifsQuery';

describe('stickersGifsQuery', () => {
  it('stickerPacksQuery запрашивает и возвращает наборы стикеров', async () => {
    server.use(
      http.get(api('/stickers/packs'), () =>
        HttpResponse.json({
          packs: [
            {
              id: 'p-1',
              name: 'Pack 1',
              description: 'Desc',
              iconUrl: 'http://icon',
              stickerCount: 2,
              createdAt: '2026-01-01',
            },
          ],
        })
      )
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const packs = await queryClient.fetchQuery(stickerPacksQuery());

    expect(packs).toHaveLength(1);
    expect(packs[0].name).toBe('Pack 1');
  });

  it('stickersQuery запрашивает стикеры конкретного набора', async () => {
    server.use(
      http.get(api('/stickers/packs/p-1'), () =>
        HttpResponse.json({
          stickers: [{ id: 's-1', imageUrl: 'http://s1.png', createdAt: '2026-01-01' }],
        })
      )
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stickers = await queryClient.fetchQuery(stickersQuery('p-1'));

    expect(stickers).toHaveLength(1);
    expect(stickers[0].imageUrl).toBe('http://s1.png');
  });

  it('gifsQuery и favoriteGifsQuery возвращают списки GIF', async () => {
    server.use(
      http.get(api('/gifs'), () =>
        HttpResponse.json({
          gifs: [{ id: 'g-1', name: 'wave', url: 'http://g1.gif', userName: 'u1', createdAt: '2026' }],
        })
      ),
      http.get(api('/gifs/favorites'), () =>
        HttpResponse.json({
          gifs: [{ id: 'g-2', name: 'dance', url: 'http://g2.gif', userName: 'u2', createdAt: '2026' }],
        })
      )
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const allGifs = await queryClient.fetchQuery(gifsQuery());
    const favGifs = await queryClient.fetchQuery(favoriteGifsQuery());

    expect(allGifs).toHaveLength(1);
    expect(allGifs[0].id).toBe('g-1');
    expect(favGifs).toHaveLength(1);
    expect(favGifs[0].id).toBe('g-2');
  });
});
