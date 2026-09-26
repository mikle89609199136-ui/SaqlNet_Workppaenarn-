import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser } from '@/test/fixtures';
import { renderSettings } from '@/test/harness/renderSettings';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

const person = (id: string, firstName: string, rule: string, mode: 'allow' | 'deny') => ({
  id,
  username: id,
  firstName,
  lastName: '',
  avatarUrl: '',
  rule,
  mode,
  createdAt: '2026-09-26T12:00:00Z',
});

/** Сервер исключений с настоящим состоянием. */
function serveExceptions(initial: ReturnType<typeof person>[]) {
  let exceptions = [...initial];
  const calls: string[] = [];
  server.use(
    http.get(api('/users/privacy/exceptions'), () => HttpResponse.json({ exceptions })),
    http.put(api('/users/privacy/exceptions/:rule/:userId'), async ({ params, request }) => {
      const { mode } = (await request.json()) as { mode: 'allow' | 'deny' };
      calls.push(`put ${String(params.rule)} ${String(params.userId)} ${mode}`);
      exceptions = exceptions.filter(
        (item) => !(item.rule === params.rule && item.id === params.userId)
      );
      const added = person(String(params.userId), 'Вера', String(params.rule), mode);
      exceptions = [added, ...exceptions];
      return HttpResponse.json({ exception: added });
    }),
    http.delete(api('/users/privacy/exceptions/:rule/:userId'), ({ params }) => {
      calls.push(`delete ${String(params.rule)} ${String(params.userId)}`);
      exceptions = exceptions.filter(
        (item) => !(item.rule === params.rule && item.id === params.userId)
      );
      return HttpResponse.json({ success: true });
    }),
    http.get(api('/users/blocked'), () => HttpResponse.json({ blocked: null }))
  );
  return calls;
}

describe('обзор «Конфиденциальности» (#786)', () => {
  it('правила со значением и числом действующих исключений', async () => {
    serveExceptions([
      person('anna', 'Анна', 'lastSeen', 'deny'),
      person('boris', 'Борис', 'lastSeen', 'deny'),
      // При «Все» список «Всегда» не действует — в число не идёт.
      person('vera', 'Вера', 'lastSeen', 'allow'),
      person('gleb', 'Глеб', 'photoVisibility', 'allow'),
    ]);

    renderSettings({
      section: 'privacy',
      privacy: { lastSeen: 'all', photoVisibility: 'nobody', forwards: 'all' },
    });

    const row = (name: RegExp) => screen.findByRole('button', { name });
    await waitFor(async () =>
      expect(await row(/Последняя активность/)).toHaveTextContent('Все (−2)')
    );
    expect(await row(/Фото профиля/)).toHaveTextContent('Никто (+1)');
    expect(await row(/Пересылка сообщений/)).toHaveTextContent(/Все$/);
  });

  it('строка правила ведёт на его подстраницу', async () => {
    serveExceptions([]);
    renderSettings({ section: 'privacy', privacy: {} });

    await userEvent.click(await screen.findByRole('button', { name: /Фото профиля/ }));

    expect(await screen.findByRole('heading', { name: 'Фото профиля' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Кто видит моё фото' })).toHaveAccessibleDescription(
      'При «Никто» другие увидят вместо фото букву или узор.'
    );
  });
});

describe('подстраница правила (#786)', () => {
  it('при «Все» — «Никогда не разрешать», при «Никто» — «Всегда разрешать»', async () => {
    serveExceptions([
      person('anna', 'Анна', 'lastSeen', 'deny'),
      person('vera', 'Вера', 'lastSeen', 'allow'),
    ]);
    // Сервер настроек с состоянием: сохранённое возвращается и при перечитывании.
    let privacy: Record<string, unknown> = { lastSeen: 'all' };
    server.use(
      http.put(api('/users/privacy'), async ({ request }) => {
        privacy = { ...privacy, ...((await request.json()) as object) };
        return HttpResponse.json({ privacy });
      }),
      http.get(api('/users/settings'), () => HttpResponse.json({ settings: {}, privacy }))
    );
    renderSettings({ section: 'privacy', subsection: 'last-seen', privacy: { lastSeen: 'all' } });

    const never = await screen.findByRole('region', { name: 'Никогда не разрешать' });
    expect(await within(never).findByText('Анна')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Всегда разрешать' })).not.toBeInTheDocument();

    const group = screen.getByRole('group', { name: 'Кто видит, когда я был(а) в сети' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Никто' }));

    const always = await screen.findByRole('region', { name: 'Всегда разрешать' });
    expect(await within(always).findByText('Вера')).toBeInTheDocument();
    expect(within(always).queryByText('Анна')).not.toBeInTheDocument();
  });

  it('добавляет через поиск: себя и уже добавленных среди найденных нет', async () => {
    const calls = serveExceptions([person('anna', 'Анна', 'photoVisibility', 'deny')]);
    server.use(
      http.get(api('/users/search'), () =>
        HttpResponse.json({
          users: [
            { id: 'me', username: 'me', firstName: 'Я', lastName: '', avatarUrl: '' },
            { id: 'anna', username: 'anna', firstName: 'Анна', lastName: '', avatarUrl: '' },
            { id: 'vera', username: 'vera', firstName: 'Вера', lastName: '', avatarUrl: '' },
          ],
        })
      )
    );
    renderSettings({
      section: 'privacy',
      subsection: 'photo',
      privacy: {},
      currentUser: makeUser({ id: 'me' }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить людей' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Найти человека' }), 'ве');

    const add = await screen.findByRole('button', { name: 'Добавить Вера' });
    expect(screen.queryByRole('button', { name: 'Добавить Я' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить Анна' })).not.toBeInTheDocument();
    await userEvent.click(add);

    const never = screen.getByRole('region', { name: 'Никогда не разрешать' });
    expect(await within(never).findByText('Вера')).toBeInTheDocument();
    expect(calls).toEqual(['put photoVisibility vera deny']);
  });

  it('убирает из исключений', async () => {
    const calls = serveExceptions([person('anna', 'Анна', 'forwards', 'deny')]);
    renderSettings({ section: 'privacy', subsection: 'forwards', privacy: {} });

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать Анна' }));

    expect(await screen.findByText('Пока никого')).toBeInTheDocument();
    expect(calls).toEqual(['delete forwards anna']);
  });

  it('напоминает, что чёрный список сильнее исключений', async () => {
    serveExceptions([]);
    renderSettings({ section: 'privacy', subsection: 'last-seen', privacy: {} });

    expect(await screen.findByText(/Чёрный список сильнее исключений/)).toBeInTheDocument();
  });
});
