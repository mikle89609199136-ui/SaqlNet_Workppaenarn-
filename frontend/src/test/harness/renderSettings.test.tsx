import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderSettings } from './renderSettings';

/**
 * Проверка самой оснастки.
 *
 * Тесты разделов будут стоять на ней целиком, поэтому её собственные
 * обещания — раздел выбирается адресом, данные приходят из кеша —
 * проверяются здесь один раз, а не в каждом разделе заново.
 */
describe('оснастка настроек', () => {
  it('открывает раздел, заданный адресом', async () => {
    renderSettings({ section: 'privacy' });

    // Заголовок раздела — в шапке страницы (#828), которой в оснастке нет.
    expect(await screen.findByRole('region', { name: 'Кто видит' })).toBeInTheDocument();
  });

  it('показывает значение из кеша, не обращаясь к серверу', async () => {
    renderSettings({
      section: 'privacy',
      subsection: 'last-seen',
      privacy: { lastSeen: 'nobody' },
    });

    const lastSeen = await screen.findByRole('radiogroup', {
      name: 'Кто видит, когда я был(а) в сети',
    });
    expect(within(lastSeen).getByRole('radio', { name: 'Никто' })).toBeChecked();
  });

  it('открывает подстраницу аккаунта по адресу', async () => {
    renderSettings({ section: 'account', subsection: 'password' });

    expect(await screen.findByLabelText('Текущий пароль')).toBeInTheDocument();
  });
});
