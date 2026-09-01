import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderSettings } from '@/test/harness/renderSettings';

/**
 * Сохранение настроек.
 *
 * Проверяется на двух границах: что ушло по сети и что осталось на экране.
 * Как именно устроен кеш — дело реализации, тест об этом не спрашивает.
 */
describe('сохранение настроек', () => {
  it('отправляет только изменённое поле, а не весь набор настроек', async () => {
    let sent: unknown;
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ settings: sent });
      })
    );

    renderSettings({ section: 'appearance', settings: { theme: 'dark', language: 'ru' } });

    await userEvent.click(await screen.findByRole('button', { name: 'Светлая' }));

    await waitFor(() => expect(sent).toEqual({ theme: 'light' }));
  });

  it('показывает выбранное значение до ответа сервера', async () => {
    server.use(
      http.put(api('/users/settings'), async () => {
        // Ответ намеренно задержан: проверяется именно то, что видно
        // человеку, пока запрос ещё идёт.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ settings: { theme: 'light' } });
      })
    );

    renderSettings({ section: 'appearance', settings: { theme: 'dark' } });

    await userEvent.click(await screen.findByRole('button', { name: 'Светлая' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Светлая' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );
  });

  it('возвращает прежнее значение, когда сервер ответил ошибкой', async () => {
    server.use(
      http.put(api('/users/settings'), () => HttpResponse.json({}, { status: 500 })),
      // После неудачи страница перечитывает настройки: сервер обязан
      // подтвердить, что изменение не сохранилось.
      http.get(api('/users/settings'), () =>
        HttpResponse.json({ settings: { theme: 'dark' }, privacy: {} })
      )
    );

    renderSettings({ section: 'appearance', settings: { theme: 'dark' } });

    await userEvent.click(await screen.findByRole('button', { name: 'Светлая' }));

    expect(await screen.findByText('Не удалось сохранить настройки')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Тёмная' })).toHaveAttribute('aria-pressed', 'true')
    );
  });

  it('возвращает прежнее значение приватности, когда сервер ответил ошибкой', async () => {
    server.use(
      http.put(api('/users/privacy'), () => HttpResponse.json({}, { status: 500 })),
      http.get(api('/users/settings'), () =>
        HttpResponse.json({ settings: {}, privacy: { lastSeen: 'all' } })
      )
    );

    renderSettings({ section: 'privacy', privacy: { lastSeen: 'all' } });

    await userEvent.click(await screen.findByRole('radio', { name: 'Никто' }));

    expect(
      await screen.findByText('Не удалось сохранить настройки приватности')
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Все' })).toBeChecked());
  });
});
