import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NavTab } from './NavTab';
import { navItems } from './navItems';

const chats = navItems.find((item) => item.key === 'chats')!;
const channels = navItems.find((item) => item.key === 'channels')!;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavTab item={chats} variant="bottom" />
      <NavTab item={channels} variant="bottom" />
    </MemoryRouter>
  );
}

describe('пункт навигации', () => {
  it('называет себя в рельсе, где подписи скрыты', () => {
    /* На широком экране у пункта нет видимого текста, и без имени ссылка
       остаётся для скринридера безымянной. */
    render(
      <MemoryRouter initialEntries={['/chats']}>
        <NavTab item={chats} variant="side" />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Чаты' })).toBeInTheDocument();
  });

  it('отмечает раздел открытым на его собственном адресе', () => {
    renderAt('/chats');

    expect(screen.getByRole('link', { name: /Чаты/ })).toHaveAttribute('aria-current', 'page');
  });

  it('остаётся отмеченным внутри раздела', () => {
    /* Открытый чат — это всё ещё раздел «Чаты», иначе на экране переписки
       подсветка уезжает и непонятно, где находишься. */
    renderAt('/chats/a04890a6-923a-4c5e-84eb-c7157cb64020');

    expect(screen.getByRole('link', { name: /Чаты/ })).toHaveAttribute('aria-current', 'page');
  });

  it('не отмечает чужой раздел', () => {
    renderAt('/channels');

    expect(screen.getByRole('link', { name: /Чаты/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /Каналы/ })).toHaveAttribute('aria-current', 'page');
  });

  it('не отмечает раздел, чей адрес лишь начинается так же', () => {
    /* Раньше активность считалась через pathname.includes(path): адрес
       вроде /chats-archive подсветил бы «Чаты», потому что подстрока
       совпадает. NavLink сравнивает сегменты и такого не делает. */
    renderAt('/chats-archive');

    expect(screen.getByRole('link', { name: /Чаты/ })).not.toHaveAttribute('aria-current');
  });
});
