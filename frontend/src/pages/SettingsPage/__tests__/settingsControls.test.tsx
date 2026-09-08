import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderSettings } from '@/test/harness/renderSettings';

/**
 * Разделы «Уведомления» и «Конфиденциальность».
 *
 * Оба состоят из одинаковых рядов и сохраняются одной мутацией, поэтому и
 * проверяются вместе: как выглядит ряд, что уходит на сервер и что
 * происходит при ошибке — один вопрос на два раздела.
 */
describe('переключатели настроек', () => {
  it('отправляет изменённое поле, а не весь набор', async () => {
    let sent: unknown;
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ settings: sent });
      })
    );

    renderSettings({ section: 'notifications', settings: { notifications: true, sounds: true } });

    await userEvent.click(await screen.findByRole('switch', { name: 'Звуки сообщений' }));

    await waitFor(() => expect(sent).toEqual({ sounds: false }));
  });

  it('возвращает переключатель в прежнее положение, когда сервер ответил ошибкой', async () => {
    server.use(
      http.put(api('/users/settings'), () => HttpResponse.json({}, { status: 500 })),
      http.get(api('/users/settings'), () =>
        HttpResponse.json({ settings: { notifications: true }, privacy: {} })
      )
    );

    renderSettings({ section: 'notifications', settings: { notifications: true } });

    await userEvent.click(await screen.findByRole('switch', { name: 'Уведомления' }));

    expect(await screen.findByText('Не удалось сохранить настройки')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Уведомления' })).toBeChecked());
  });

  it('подпись слева переключает элемент управления', async () => {
    // Сервер с памятью: после сохранения страница перечитывает настройки, и
    // обработчик по умолчанию вернул бы прежнее значение — проверка бы
    // прошла независимо от того, сработало нажатие или нет.
    let stored: Record<string, unknown> = { notifications: true };
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        stored = { ...stored, ...(await request.json()) };
        return HttpResponse.json({ settings: stored });
      }),
      http.get(api('/users/settings'), () => HttpResponse.json({ settings: stored, privacy: {} }))
    );

    renderSettings({ section: 'notifications', settings: { notifications: true } });

    const label = await screen.findByText('Уведомления');
    await userEvent.click(label);

    // Подпись стоит вне компонента, поэтому связь задаётся руками через
    // htmlFor. Если её потерять, нажатие по названию перестанет работать,
    // а диктор не сообщит, чем управляет переключатель.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Уведомления' })).not.toBeChecked()
    );
  });

  it('не отправляет значение, которого нет в списке', async () => {
    const sent: unknown[] = [];
    server.use(
      http.put(api('/users/privacy'), async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ privacy: {} });
      })
    );

    renderSettings({ section: 'privacy', privacy: { lastSeen: 'all' } });

    await userEvent.click(await screen.findByRole('radio', { name: 'Контакты' }));

    // Сервер значения не проверяет (#439), поэтому список допустимых
    // держит клиент: уходит ровно то, что предложено человеку.
    await waitFor(() => expect(sent).toEqual([{ lastSeen: 'contacts' }]));
  });
});
