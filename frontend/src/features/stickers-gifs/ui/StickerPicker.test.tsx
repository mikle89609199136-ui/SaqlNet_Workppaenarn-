import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { StickerPicker } from './StickerPicker';
import type { ISticker } from '@/entities/media';

describe('StickerPicker', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  function renderPicker(onPick = vi.fn()) {
    return {
      onPick,
      ...render(
        <QueryClientProvider client={queryClient}>
          <StickerPicker onPick={onPick} />
        </QueryClientProvider>
      ),
    };
  }

  it('показывает пустое состояние, когда у пользователя нет наборов', async () => {
    server.use(http.get(api('/stickers/packs'), () => HttpResponse.json({ packs: [] })));

    renderPicker();

    expect(await screen.findByText('Нет наборов стикеров')).toBeInTheDocument();
    expect(screen.getByText('У вас пока нет добавленных наборов стикеров')).toBeInTheDocument();
  });

  it('отображает наборы и стикеры активного набора, и вызывает onPick при клике', async () => {
    server.use(
      http.get(api('/stickers/packs'), () =>
        HttpResponse.json({
          packs: [
            {
              id: 'pack-1',
              name: 'Котики',
              description: 'Пак с котиками',
              iconUrl: 'http://icon1.png',
              stickerCount: 2,
              createdAt: '2026-01-01',
            },
            {
              id: 'pack-2',
              name: 'Собачки',
              description: 'Пак с собачками',
              iconUrl: 'http://icon2.png',
              stickerCount: 1,
              createdAt: '2026-01-01',
            },
          ],
        })
      ),
      http.get(api('/stickers/packs/pack-1'), () =>
        HttpResponse.json({
          stickers: [
            { id: 's-1', imageUrl: 'http://cat1.png', createdAt: '2026-01-01' },
            { id: 's-2', imageUrl: 'http://cat2.png', createdAt: '2026-01-01' },
          ],
        })
      ),
      http.get(api('/stickers/packs/pack-2'), () =>
        HttpResponse.json({
          stickers: [{ id: 's-3', imageUrl: 'http://dog1.png', createdAt: '2026-01-01' }],
        })
      )
    );

    const onPick = vi.fn();
    renderPicker(onPick);

    expect(await screen.findByTitle('Котики')).toBeInTheDocument();
    expect(screen.getByTitle('Собачки')).toBeInTheDocument();

    const stickerButtons = await screen.findAllByRole('button', { name: 'Стикер' });
    expect(stickerButtons).toHaveLength(2);

    fireEvent.click(stickerButtons[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining<Partial<ISticker>>({ id: 's-1', imageUrl: 'http://cat1.png' })
    );

    // Переключение набора
    fireEvent.click(screen.getByTitle('Собачки'));
    await waitFor(() => {
      const dogButtons = screen.getAllByRole('button', { name: 'Стикер' });
      expect(dogButtons).toHaveLength(1);
    });
  });
});
