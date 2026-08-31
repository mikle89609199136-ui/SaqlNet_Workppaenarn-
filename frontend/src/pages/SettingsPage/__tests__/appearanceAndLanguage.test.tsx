import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderSettings } from '@/test/harness/renderSettings';

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
    await userEvent.click(await screen.findByRole('option', { name: 'Deutsch' }));

    await waitFor(() => expect(sent).toEqual({ language: 'de' }));
  });

  it('показывает язык, сохранённый на сервере', async () => {
    renderSettings({ section: 'language', settings: { language: 'tr' } });

    expect(await screen.findByRole('combobox')).toHaveTextContent('Türkçe');
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
