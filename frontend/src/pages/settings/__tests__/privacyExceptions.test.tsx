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
      person('ivan', 'Иван', 'calls', 'deny'),
    ]);

    renderSettings({
      section: 'privacy',
      privacy: { lastSeen: 'all', photoVisibility: 'nobody', forwards: 'all', calls: 'all' },
    });

    const row = (name: RegExp) => screen.findByRole('link', { name });
    await waitFor(async () =>
      expect(await row(/Последняя активность/)).toHaveTextContent('Все (−2)')
    );
    expect(await row(/Фото профиля/)).toHaveTextContent('Никто (+1)');
    expect(await row(/Пересылка сообщений/)).toHaveTextContent(/Все$/);
    expect(await row(/Кто может звонить/)).toHaveTextContent('Все (−1)');
  });

  it('строка правила ведёт на его подстраницу', async () => {
    serveExceptions([]);
    renderSettings({ section: 'privacy', privacy: {} });

    await userEvent.click(await screen.findByRole('link', { name: /Фото профиля/ }));

    expect(
      await screen.findByRole('radiogroup', { name: 'Кто видит моё фото' })
    ).toHaveAccessibleDescription('При «Никто» другие увидят вместо фото букву или узор.');
  });

  it('строка правила «Кто может звонить» ведёт на его подстраницу (#1043)', async () => {
    serveExceptions([]);
    renderSettings({ section: 'privacy', privacy: {} });

    await userEvent.click(await screen.findByRole('link', { name: /Кто может звонить/ }));

    expect(
      await screen.findByRole('radiogroup', { name: 'Кто может мне звонить' })
    ).toHaveAccessibleDescription(/входящие звонки будут отклоняться/);
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

    /* Группа «Исключения» по макету (#828); какой список в ней — говорит
       ряд «добавить». */
    const never = await screen.findByRole('region', { name: 'Исключения' });
    expect(
      within(never).getByRole('button', { name: /^Никогда не разрешать/ })
    ).toBeInTheDocument();
    expect(await within(never).findByText('Анна')).toBeInTheDocument();
    expect(within(never).queryByRole('button', { name: /^Всегда разрешать/ })).toBeNull();

    const group = screen.getByRole('radiogroup', { name: 'Кто видит, когда я был(а) в сети' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Никто' }));

    const always = screen.getByRole('region', { name: 'Исключения' });
    await within(always).findByRole('button', { name: /^Всегда разрешать/ });
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

    await userEvent.click(await screen.findByRole('button', { name: /^Никогда не разрешать/ }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Найти человека' }), 'ве');

    const add = await screen.findByRole('button', { name: 'Добавить Вера' });
    expect(screen.queryByRole('button', { name: 'Добавить Я' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить Анна' })).not.toBeInTheDocument();
    await userEvent.click(add);

    const never = screen.getByRole('region', { name: 'Исключения' });
    expect(await within(never).findByText('Вера')).toBeInTheDocument();
    expect(calls).toEqual(['put photoVisibility vera deny']);
  });

  it('убирает из исключений', async () => {
    const calls = serveExceptions([person('anna', 'Анна', 'forwards', 'deny')]);
    renderSettings({ section: 'privacy', subsection: 'forwards', privacy: {} });

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать Анна' }));

    await waitFor(() => expect(screen.queryByText('Анна')).not.toBeInTheDocument());
    expect(calls).toEqual(['delete forwards anna']);
  });

  it('напоминает, что чёрный список сильнее исключений', async () => {
    serveExceptions([]);
    renderSettings({ section: 'privacy', subsection: 'last-seen', privacy: {} });

    expect(await screen.findByText(/Чёрный список сильнее исключений/)).toBeInTheDocument();
  });

  it('подстраница «Кто может звонить»: переключает на «Никто» и сохраняет настройку (#1043)', async () => {
    serveExceptions([person('dina', 'Дина', 'calls', 'allow')]);
    let savedPrivacy: unknown = null;
    server.use(
      http.put(api('/users/privacy'), async ({ request }) => {
        savedPrivacy = await request.json();
        return HttpResponse.json({ privacy: { calls: 'nobody' } });
      }),
      http.get(api('/users/settings'), () =>
        HttpResponse.json({ settings: {}, privacy: { calls: 'nobody' } })
      )
    );
    renderSettings({ section: 'privacy', subsection: 'calls', privacy: { calls: 'all' } });

    const group = await screen.findByRole('radiogroup', { name: 'Кто может мне звонить' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Никто' }));

    await waitFor(() => expect(savedPrivacy).toEqual({ calls: 'nobody' }));
    const always = await screen.findByRole('region', { name: 'Исключения' });
    await within(always).findByRole('button', { name: /^Всегда разрешать/ });
    expect(await within(always).findByText('Дина')).toBeInTheDocument();
  });

  it('подстраница «Кто может звонить»: добавляет и удаляет исключения (#1043)', async () => {
    const calls = serveExceptions([person('ivan', 'Иван', 'calls', 'deny')]);
    server.use(
      http.get(api('/users/search'), () =>
        HttpResponse.json({
          users: [{ id: 'vera', username: 'vera', firstName: 'Вера', lastName: '', avatarUrl: '' }],
        })
      )
    );
    renderSettings({
      section: 'privacy',
      subsection: 'calls',
      privacy: { calls: 'all' },
      currentUser: makeUser({ id: 'me' }),
    });

    // Удаляем Ивана из deny
    await userEvent.click(await screen.findByRole('button', { name: 'Убрать Иван' }));
    await waitFor(() => expect(screen.queryByText('Иван')).not.toBeInTheDocument());
    expect(calls).toContain('delete calls ivan');

    // Добавляем Веру в deny
    await userEvent.click(await screen.findByRole('button', { name: /^Никогда не разрешать/ }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Найти человека' }), 'ве');
    await userEvent.click(await screen.findByRole('button', { name: 'Добавить Вера' }));

    const never = screen.getByRole('region', { name: 'Исключения' });
    expect(await within(never).findByText('Вера')).toBeInTheDocument();
    expect(calls).toContain('put calls vera deny');
  });
});
