import { screen, waitFor, within } from '@testing-library/react';
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

  it('предлагает только «Все» и «Никто» и отправляет выбранное', async () => {
    const sent: unknown[] = [];
    server.use(
      http.put(api('/users/privacy'), async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ privacy: {} });
      })
    );

    renderSettings({ section: 'privacy', subsection: 'last-seen', privacy: { lastSeen: 'all' } });

    // Контактов в приложении нет — и варианта «Контакты» тоже (#726).
    const lastSeen = await screen.findByRole('radiogroup', {
      name: 'Кто видит, когда я был(а) в сети',
    });
    expect(within(lastSeen).getByRole('radio', { name: 'Никто' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Контакты' })).not.toBeInTheDocument();

    await userEvent.click(within(lastSeen).getByRole('radio', { name: 'Никто' }));

    await waitFor(() => expect(sent).toEqual([{ lastSeen: 'nobody' }]));
  });

  it('правило «Пересылка сообщений»: «Все» / «Никто» с подсказкой (#785)', async () => {
    const sent: unknown[] = [];
    server.use(
      http.put(api('/users/privacy'), async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ privacy: {} });
      })
    );

    renderSettings({ section: 'privacy', subsection: 'forwards', privacy: { lastSeen: 'all' } });

    const forwards = await screen.findByRole('radiogroup', {
      name: 'Кто может ссылаться на мой аккаунт при пересылке',
    });
    // Настройки ещё нет — по умолчанию «Все», как и на сервере.
    expect(within(forwards).getByRole('radio', { name: 'Все' })).toBeChecked();
    expect(forwards).toHaveAccessibleDescription(/останется только ваше имя/);

    await userEvent.click(within(forwards).getByRole('radio', { name: 'Никто' }));

    await waitFor(() => expect(sent).toEqual([{ forwards: 'nobody' }]));
  });

  it('«Чёрный список» — число заблокированных и переход к списку (#727)', async () => {
    const person = (id: string, name: string) => ({
      id,
      username: id,
      firstName: name,
      lastName: '',
      avatarUrl: '',
      blockedAt: '2026-09-26T12:00:00Z',
    });
    server.use(
      http.get(api('/users/blocked'), () =>
        HttpResponse.json({ blocked: [person('anna', 'Анна'), person('boris', 'Борис')] })
      )
    );

    renderSettings({ section: 'privacy', privacy: { lastSeen: 'all' } });

    const row = await screen.findByRole('link', { name: /Чёрный список/ });
    await waitFor(() => expect(row).toHaveTextContent('2'));
    await userEvent.click(row);

    expect(await screen.findByText('Анна')).toBeInTheDocument();
    expect(screen.getByText('Борис')).toBeInTheDocument();
  });

  it('объясняет, что будет при «Никто», и связывает подсказку с выбором', async () => {
    renderSettings({ section: 'privacy', subsection: 'last-seen', privacy: { lastSeen: 'all' } });

    const group = await screen.findByRole('radiogroup', {
      name: 'Кто видит, когда я был(а) в сети',
    });
    // Взаимность и приблизительное время (#791) — в описании группы, которое
    // зачитает и диктор.
    expect(group).toHaveAccessibleDescription(/только приблизительное/);
    expect(group).toHaveAccessibleDescription(/вы не будете видеть точное время других/);
  });
});
