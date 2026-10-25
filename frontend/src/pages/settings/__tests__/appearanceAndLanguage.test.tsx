import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderSettings } from '@/test/harness/renderSettings';
import { testI18n } from '@/test/harness/i18n';
import { clearToasts, getToasts } from '@/shared/ui';
import { STORAGE_KEYS } from '@/shared/config';

/**
 * Разделы «Внешний вид» и «Язык».
 *
 * Оба выбирают значение из нескольких и оба применяются сразу, поэтому
 * важно не только что ушло на сервер, но и что человек увидел на экране.
 */
describe('внешний вид и язык', () => {
  it('отправляет выбранный язык', async () => {
    let sent: unknown;
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ settings: sent });
      })
    );

    renderSettings({ section: 'language', settings: { language: 'ru' } });

    await userEvent.click(await screen.findByRole('radio', { name: /^English/ }));

    await waitFor(() => expect(sent).toEqual({ language: 'en' }));
  });

  it('сообщает о сохранении уже на выбранном языке', async () => {
    // Раньше тост брал перевод, пойманный до смены языка, и после выбора
    // English говорил «Настройки сохранены».
    testI18n.addResource('en', 'translation', 'settingsSaved', 'Settings saved');
    clearToasts();
    server.use(
      http.get(api('/users/settings'), () =>
        HttpResponse.json({ settings: { language: 'en' }, privacy: {} })
      ),
      http.put(api('/users/settings'), async ({ request }) =>
        HttpResponse.json({ settings: await request.json() })
      )
    );

    try {
      renderSettings({ section: 'language', settings: { language: 'ru' } });

      await userEvent.click(await screen.findByRole('radio', { name: /^English/ }));

      await waitFor(() =>
        expect(getToasts().map((toast) => toast.message)).toContain('Settings saved')
      );
      expect(getToasts().map((toast) => toast.message)).not.toContain('Настройки сохранены');
    } finally {
      // Экземпляр общий для всех тестов: возвращаем русский.
      await testI18n.changeLanguage('ru');
      clearToasts();
    }
  });

  it('предлагает только переведённые языки', async () => {
    renderSettings({ section: 'language', settings: { language: 'ru' } });

    // Список — это то, на что интерфейс переведён. Раньше здесь висело
    // десять пунктов, из них восемь недоступных: человек читал их как
    // обещание, а получал заглушки.
    const group = await screen.findByRole('radiogroup', { name: 'Язык приложения' });
    expect(within(group).getByRole('radio', { name: 'Русский' })).toBeInTheDocument();
    // Под названием на самом языке — название на языке интерфейса (#828).
    expect(
      within(group).getByRole('radio', { name: 'English', description: 'Английский' })
    ).toBeInTheDocument();
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
  });

  it('показывает язык, сохранённый на сервере', async () => {
    renderSettings({ section: 'language', settings: { language: 'en' } });

    expect(await screen.findByRole('radio', { name: /^English/ })).toBeChecked();
  });

  it('незнакомый язык с сервера показывает как русский', async () => {
    // У заведённых раньше в настройках мог остаться «tr»: выбор был из
    // десяти, а словарей два. Интерфейс у них всё равно русский — это и
    // показываем, вместо пустого поля.
    renderSettings({ section: 'language', settings: { language: 'tr' } });

    expect(await screen.findByRole('radio', { name: 'Русский' })).toBeChecked();
  });

  it('меняет вид аватарки вместе с выбором', async () => {
    /* Сервер помнит сохранённое: после ответа настройки перечитываются,
       и сервер-заглушка с пустыми настройками вернул бы букву. Прежде
       это пряталось — проверку проходил значок уведомления «Настройки
       сохранены», а не сетка аватарки. */
    let saved: Record<string, unknown> = { avatarShape: 'letter' };
    server.use(
      http.get(api('/users/settings'), () => HttpResponse.json({ settings: saved, privacy: {} })),
      http.put(api('/users/settings'), async ({ request }) => {
        saved = { ...saved, ...((await request.json()) as Record<string, unknown>) };
        return HttpResponse.json({ settings: saved });
      })
    );

    renderSettings({ section: 'appearance', settings: { avatarShape: 'letter' } });

    const group = await screen.findByRole('radiogroup', { name: 'Аватарка без фотографии' });
    const grid = within(group).getByRole('radio', { name: /^Сетка/ });
    // У каждого варианта свой образец: буква — текст, сетка — рисунок.
    // Проверяется то, что видно на экране, а не пропс компонента.
    expect(
      within(group)
        .getByRole('radio', { name: /^Буква/ })
        .querySelector('svg')
    ).toBeNull();
    expect(grid.querySelector('svg')).not.toBeNull();

    await userEvent.click(grid);

    await waitFor(() => expect(grid).toBeChecked());
    expect(saved.avatarShape).toBe('grid');
  });

  it('возвращает прежний вид аватарки, когда сервер ответил ошибкой', async () => {
    server.use(
      http.put(api('/users/settings'), () => HttpResponse.json({}, { status: 500 })),
      http.get(api('/users/settings'), () =>
        HttpResponse.json({ settings: { avatarShape: 'letter' }, privacy: {} })
      )
    );

    renderSettings({ section: 'appearance', settings: { avatarShape: 'letter' } });

    await userEvent.click(await screen.findByRole('radio', { name: /^Сетка/ }));

    expect(await screen.findByText('Не удалось сохранить настройки')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Буква/ })).toBeChecked());
  });

  it('палитра и акцент сохраняются на сервере отдельными патчами (#728)', async () => {
    let saved: Record<string, unknown> = {};
    const patches: unknown[] = [];
    server.use(
      http.get(api('/users/settings'), () => HttpResponse.json({ settings: saved, privacy: {} })),
      http.put(api('/users/settings'), async ({ request }) => {
        const patch = await request.json();
        patches.push(patch);
        saved = { ...saved, ...(patch as object) };
        return HttpResponse.json({ success: true });
      })
    );
    renderSettings({ section: 'appearance', settings: {} });
    await userEvent.click(await screen.findByRole('radio', { name: 'Полночь' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Бирюзовый' })).toBeEnabled());
    await userEvent.click(screen.getByRole('radio', { name: 'Бирюзовый' }));
    await waitFor(() =>
      expect(patches).toEqual([{ palette: 'midnight' }, { accentPreset: 'teal' }])
    );
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Бирюзовый' })).toBeChecked());
    expect(localStorage.getItem(STORAGE_KEYS.APPEARANCE)).toBeNull();
    expect(document.documentElement).toHaveAttribute('data-palette', 'midnight');
    expect(document.documentElement).toHaveAttribute('data-accent', 'teal');
  });

  it.each([
    ['Системная', { theme: 'system' }],
    ['Крупный', { textSize: 'large' }],
    ['Компактный', { chatDensity: 'compact' }],
  ])('сохраняет вариант %s', async (name, patch) => {
    let sent: unknown;
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ success: true });
      })
    );
    renderSettings({ section: 'appearance', settings: {} });
    await userEvent.click(await screen.findByRole('radio', { name: name as string }));
    await waitFor(() => expect(sent).toEqual(patch));
  });

  it.each([
    ['Время сообщений', 'showMessageTime'],
    ['Статусы доставки и прочтения', 'showMessageStatus'],
    ['Аватарки в ленте группы', 'showMessageAvatars'],
    ['Группировать сообщения одного автора', 'groupConsecutiveMessages'],
  ])('сохраняет переключатель %s', async (name, field) => {
    let sent: unknown;
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ success: true });
      })
    );
    renderSettings({ section: 'appearance', settings: {} });
    await userEvent.click(await screen.findByRole('switch', { name }));
    await waitFor(() => expect(sent).toEqual({ [field]: false }));
  });

  it('переносит прежний браузерный выбор только по кнопке и удаляет его после успеха', async () => {
    localStorage.setItem(
      STORAGE_KEYS.APPEARANCE,
      JSON.stringify({ palette: 'warm', accent: 'amber' })
    );
    let sent: unknown;
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ success: true });
      })
    );
    renderSettings({
      section: 'appearance',
      settings: { palette: 'midnight', accentPreset: 'teal' },
    });
    expect(await screen.findByRole('radio', { name: 'Полночь' })).toBeChecked();
    expect(sent).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: /Применить прежнюю палитру/ }));
    await waitFor(() => expect(sent).toEqual({ palette: 'warm', accentPreset: 'amber' }));
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEYS.APPEARANCE)).toBeNull());
  });

  it('группы вариантов поддерживают стрелки и одну остановку Tab', async () => {
    server.use(http.put(api('/users/settings'), () => HttpResponse.json({ success: true })));
    renderSettings({ section: 'appearance', settings: {} });
    const group = await screen.findByRole('radiogroup', { name: 'Тема' });
    const selected = within(group).getByRole('radio', { name: 'Тёмная' });
    expect(
      within(group)
        .getAllByRole('radio')
        .filter((radio) => radio.tabIndex === 0)
    ).toEqual([selected]);
    selected.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(group).getByRole('radio', { name: 'Светлая' })).toHaveFocus();
  });
  it('ошибка сохранения откатывает оформление и не пишет оптимистичный выбор в проекцию', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    server.use(
      http.get(api('/users/settings'), () =>
        HttpResponse.json({ settings: { palette: 'warm' }, privacy: {} })
      ),
      http.put(api('/users/settings'), async () => {
        await gate;
        return HttpResponse.json({}, { status: 500 });
      })
    );
    renderSettings({ section: 'appearance', settings: { palette: 'warm' } });
    await userEvent.click(await screen.findByRole('radio', { name: 'Полночь' }));
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-palette', 'midnight')
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toMatchObject({
      palette: 'warm',
    });
    finish();
    expect(await screen.findByText('Не удалось сохранить настройки')).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-palette', 'warm'));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toMatchObject({
      palette: 'warm',
    });
  });
});
