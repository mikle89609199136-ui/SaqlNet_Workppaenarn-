import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderSettings } from '@/test/harness/renderSettings';
import { testI18n } from '@/test/harness/i18n';
import { clearToasts, getToasts } from '@/shared/ui';

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

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'English' }));

    await waitFor(() => expect(sent).toEqual({ language: 'en' }));
  });

  it('сообщает о сохранении уже на выбранном языке', async () => {
    // Раньше тост брал перевод, пойманный до смены языка, и после выбора
    // English говорил «Настройки сохранены».
    testI18n.addResource('en', 'translation', 'settingsSaved', 'Settings saved');
    clearToasts();
    server.use(
      http.put(api('/users/settings'), async ({ request }) =>
        HttpResponse.json({ settings: await request.json() })
      )
    );

    try {
      renderSettings({ section: 'language', settings: { language: 'ru' } });

      await userEvent.click(await screen.findByRole('combobox'));
      await userEvent.click(await screen.findByRole('option', { name: 'English' }));

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

    await userEvent.click(await screen.findByRole('combobox'));

    // Список — это то, на что интерфейс переведён. Раньше здесь висело
    // десять пунктов, из них восемь недоступных: человек читал их как
    // обещание, а получал заглушки.
    expect(await screen.findByRole('option', { name: 'Русский' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('показывает язык, сохранённый на сервере', async () => {
    renderSettings({ section: 'language', settings: { language: 'en' } });

    expect(await screen.findByRole('combobox')).toHaveTextContent('English');
  });

  it('незнакомый язык с сервера показывает как русский', async () => {
    // У заведённых раньше в настройках мог остаться «tr»: выбор был из
    // десяти, а словарей два. Интерфейс у них всё равно русский — это и
    // показываем, вместо пустого поля.
    renderSettings({ section: 'language', settings: { language: 'tr' } });

    expect(await screen.findByRole('combobox')).toHaveTextContent('Русский');
  });

  it('меняет вид аватарки вместе с выбором', async () => {
    const { container } = renderSettings({
      section: 'appearance',
      settings: { avatarShape: 'letter' },
    });

    // Буква — это текст, сетка — рисунок. Проверяется то, что видно на
    // экране, а не то, какой пропс получил компонент.
    await screen.findByRole('button', { name: 'Сетка' });
    expect(container.querySelector('svg')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Сетка' }));

    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull());
  });

  it('возвращает прежний вид аватарки, когда сервер ответил ошибкой', async () => {
    server.use(
      http.put(api('/users/settings'), () => HttpResponse.json({}, { status: 500 })),
      http.get(api('/users/settings'), () =>
        HttpResponse.json({ settings: { avatarShape: 'letter' }, privacy: {} })
      )
    );

    renderSettings({ section: 'appearance', settings: { avatarShape: 'letter' } });

    await userEvent.click(await screen.findByRole('button', { name: 'Сетка' }));

    expect(await screen.findByText('Не удалось сохранить настройки')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Буква' })).toHaveAttribute('aria-pressed', 'true')
    );
  });
});
