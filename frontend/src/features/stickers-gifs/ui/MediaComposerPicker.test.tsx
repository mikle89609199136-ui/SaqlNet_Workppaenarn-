import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { MediaComposerPicker } from './MediaComposerPicker';

describe('MediaComposerPicker', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    server.use(
      http.get(api('/stickers/packs'), () => HttpResponse.json({ packs: [] })),
      http.get(api('/gifs'), () => HttpResponse.json({ gifs: [] })),
      http.get(api('/gifs/favorites'), () => HttpResponse.json({ gifs: [] }))
    );
  });

  function renderPicker(props = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MediaComposerPicker
          onPickEmoji={vi.fn()}
          onPickGif={vi.fn()}
          onPickSticker={vi.fn()}
          {...props}
        />
      </QueryClientProvider>
    );
  }

  it('рендерит вкладки первого уровня: Эмодзи, Стикеры, GIF', () => {
    renderPicker();

    expect(screen.getByRole('tab', { name: /Эмодзи/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Стикеры/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /GIF/i })).toBeInTheDocument();
  });

  it('по умолчанию открыта вкладка Эмодзи, переключается на Стикеры и GIF', async () => {
    renderPicker();

    // Вкладка Эмодзи: есть поиск эмодзи
    expect(screen.getByPlaceholderText('Поиск эмодзи')).toBeInTheDocument();

    // Переключаем на Стикеры
    fireEvent.click(screen.getByRole('tab', { name: /Стикеры/i }));
    expect(await screen.findByText('Нет наборов стикеров')).toBeInTheDocument();

    // Переключаем на GIF
    fireEvent.click(screen.getByRole('tab', { name: /GIF/i }));
    expect(screen.getByPlaceholderText('Поиск GIF')).toBeInTheDocument();
  });

  it('пробрасывает onKeyDown при нажатии клавиш', () => {
    const onKeyDown = vi.fn();
    renderPicker({ onKeyDown });

    const dialog = screen.getByRole('dialog', { name: 'Медиа' });
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
