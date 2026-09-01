import { screen } from '@testing-library/react';
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

    expect(await screen.findByText('Конфиденциальность')).toBeInTheDocument();
  });

  it('показывает значение из кеша, не обращаясь к серверу', async () => {
    renderSettings({ section: 'privacy', privacy: { lastSeen: 'nobody' } });

    // Значение выбранного варианта показано в свёрнутом виде — в списке оно
    // встречается ещё раз, поэтому проверяется именно подпись.
    expect(await screen.findByText('Никто', { selector: 'summary span' })).toBeInTheDocument();
  });

  it('открывает подстраницу аккаунта по адресу', async () => {
    renderSettings({ section: 'account', subsection: 'password' });

    expect(await screen.findByRole('heading', { name: 'Изменить пароль' })).toBeInTheDocument();
  });
});
