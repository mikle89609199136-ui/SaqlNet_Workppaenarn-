import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { GifPicker } from './GifPicker';
import type { IGif } from '@/entities/media';

describe('GifPicker', () => {
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
          <GifPicker onPick={onPick} />
        </QueryClientProvider>
      ),
    };
  }

  it('отображает GIF, позволяет фильтровать по поиску и вызывать onPick', async () => {
    server.use(
      http.get(api('/gifs'), () =>
        HttpResponse.json({
          gifs: [
            {
              id: 'g-1',
              name: 'wave hello',
              url: 'http://wave.gif',
              userName: 'alice',
              createdAt: '2026-01-01',
            },
            {
              id: 'g-2',
              name: 'dance party',
              url: 'http://dance.gif',
              userName: 'bob',
              createdAt: '2026-01-01',
            },
          ],
        })
      ),
      http.get(api('/gifs/favorites'), () => HttpResponse.json({ gifs: [] }))
    );

    const onPick = vi.fn();
    renderPicker(onPick);

    expect(await screen.findByLabelText('wave hello')).toBeInTheDocument();
    expect(screen.getByLabelText('dance party')).toBeInTheDocument();

    // Фильтрация
    const searchInput = screen.getByPlaceholderText('Поиск GIF');
    fireEvent.change(searchInput, { target: { value: 'dance' } });

    expect(screen.queryByLabelText('wave hello')).not.toBeInTheDocument();
    expect(screen.getByLabelText('dance party')).toBeInTheDocument();

    // Выбор GIF
    fireEvent.click(screen.getByLabelText('dance party'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining<Partial<IGif>>({ id: 'g-2', name: 'dance party' })
    );
  });

  it('переключает вкладку "Избранные" и позволяет добавлять/удалять из избранного', async () => {
    const favoriteIds = new Set<string>();

    server.use(
      http.get(api('/gifs'), () =>
        HttpResponse.json({
          gifs: [
            {
              id: 'g-1',
              name: 'wave hello',
              url: 'http://wave.gif',
              userName: 'alice',
              createdAt: '2026-01-01',
            },
          ],
        })
      ),
      http.get(api('/gifs/favorites'), () =>
        HttpResponse.json({
          gifs: favoriteIds.has('g-1')
            ? [
                {
                  id: 'g-1',
                  name: 'wave hello',
                  url: 'http://wave.gif',
                  userName: 'alice',
                  createdAt: '2026-01-01',
                },
              ]
            : [],
        })
      ),
      http.post(api('/gifs/:gifId/favorite'), ({ params }) => {
        favoriteIds.add(String(params.gifId));
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
      http.delete(api('/gifs/:gifId/favorite'), ({ params }) => {
        favoriteIds.delete(String(params.gifId));
        return HttpResponse.json({ success: true });
      })
    );

    const onPick = vi.fn();
    renderPicker(onPick);

    expect(await screen.findByLabelText('wave hello')).toBeInTheDocument();

    // Клик по сердечку
    const favButton = screen.getByTitle('В избранное');
    fireEvent.click(favButton);

    // onPick НЕ должен вызваться
    expect(onPick).not.toHaveBeenCalled();

    // Переключаем на вкладку "Избранные"
    const favTab = screen.getByRole('tab', { name: /Избранные/i });
    fireEvent.click(favTab);

    await waitFor(() => {
      expect(screen.getByLabelText('wave hello')).toBeInTheDocument();
    });
  });

  it('показывает "Пока нет GIF", когда список пуст во вкладке Все', async () => {
    server.use(
      http.get(api('/gifs'), () => HttpResponse.json({ gifs: [] })),
      http.get(api('/gifs/favorites'), () => HttpResponse.json({ gifs: [] }))
    );

    renderPicker();

    expect(await screen.findByText('Пока нет GIF')).toBeInTheDocument();
  });

  it('показывает "Ничего не нашлось", если поиск не дал результатов', async () => {
    server.use(
      http.get(api('/gifs'), () =>
        HttpResponse.json({
          gifs: [
            {
              id: 'g-1',
              name: 'wave hello',
              url: 'http://wave.gif',
              userName: 'alice',
              createdAt: '2026-01-01',
            },
          ],
        })
      ),
      http.get(api('/gifs/favorites'), () => HttpResponse.json({ gifs: [] }))
    );

    renderPicker();

    expect(await screen.findByLabelText('wave hello')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Поиск GIF');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(await screen.findByText('Ничего не нашлось')).toBeInTheDocument();
  });
});
