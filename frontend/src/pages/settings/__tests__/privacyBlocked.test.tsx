import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { services } from '@/services/serviceContainer';
import { renderSettings } from '@/test/harness/renderSettings';
import { searchSettings } from '@/pages/settings/model/settingsIndex';

describe('раздел приватности: заблокированные пользователи', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('отображает строку перехода в чёрный список со счётчиком в обзоре', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([
      {
        id: 'u-1',
        username: 'blocked_user',
        firstName: 'Blocked',
        lastName: 'One',
        avatarUrl: '',
        blockedAt: '2026-01-01',
      },
    ]);

    renderSettings({ section: 'privacy' });

    expect(await screen.findByText('Заблокированные пользователи')).toBeInTheDocument();
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('переходит в подраздел заблокированных при клике на строку', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([]);
    const user = userEvent.setup();

    renderSettings({ section: 'privacy' });

    const blockedRow = await screen.findByRole('button', {
      name: /заблокированные пользователи/i,
    });
    await user.click(blockedRow);

    expect(await screen.findByText('В чёрном списке пока никого нет')).toBeInTheDocument();
  });

  it('открывает подраздел напрямую по адресу /settings/privacy/blocked', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([
      {
        id: 'u-1',
        username: 'blocked_user',
        firstName: 'Иван',
        lastName: 'Блоков',
        avatarUrl: '',
        blockedAt: '2026-01-01',
      },
    ]);

    renderSettings({ section: 'privacy', subsection: 'blocked' });

    expect(await screen.findByText('Иван Блоков')).toBeInTheDocument();
    expect(screen.getByText('@blocked_user')).toBeInTheDocument();
  });

  it('возвращается в обзор приватности при клике "Назад"', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([]);
    const user = userEvent.setup();

    renderSettings({ section: 'privacy', subsection: 'blocked' });

    const backBtn = await screen.findByRole('button', { name: /назад/i });
    await user.click(backBtn);

    expect(await screen.findByText('Последняя активность')).toBeInTheDocument();
  });

  it('находит пункт чёрного списка в поиске настроек по ключевым словам', () => {
    const byTitle = searchSettings('заблокированные');
    expect(byTitle.some((e) => e.path === '/settings/privacy/blocked')).toBe(true);

    const bySynonym = searchSettings('черный список');
    expect(bySynonym.some((e) => e.path === '/settings/privacy/blocked')).toBe(true);

    const byYo = searchSettings('чёрный список');
    expect(byYo.some((e) => e.path === '/settings/privacy/blocked')).toBe(true);
  });
});
