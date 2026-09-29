import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ChatsPage } from './ChatsPage';

let mockIsMobile = false;

vi.mock('@/shared/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useIsMobile: () => mockIsMobile,
    usePaneWidth: () => ({
      width: 360,
      custom: false,
      setWidth: vi.fn(),
      remember: vi.fn(),
      nudge: vi.fn(),
      jump: vi.fn(),
    }),
  };
});

vi.mock('@/widgets/chats-list', () => ({
  ChatsList: () => <div data-testid="chats-list">Список чатов</div>,
}));

vi.mock('@/features/group-management', () => ({
  CreateGroupModal: () => <div data-testid="create-group-modal">Создание группы</div>,
}));

vi.mock('@/features/user-profile', () => ({
  UserProfilePanel: () => <div data-testid="user-profile-panel">Профиль пользователя</div>,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useParams: () => ({ chatId: undefined }),
    /* Тред открывает профиль через контекст — так же поступает и
       заглушка, чтобы проверять панель без настоящего треда. */
    Outlet: ({ context }: { context: { onProfileStateChange: (state: unknown) => void } }) => (
      <div data-testid="outlet">
        Контент треда
        <button
          onClick={() => context.onProfileStateChange({ isOpen: true, userId: 'u-1', chat: null })}
          type="button"
        >
          Открыть профиль
        </button>
      </div>
    ),
  };
});

describe('ChatsPage', () => {
  beforeEach(() => {
    mockIsMobile = false;
    vi.clearAllMocks();
  });

  it('рендерит десктопную раскладку с панелью чатов и ресайзером', () => {
    render(
      <MemoryRouter>
        <ChatsPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('chats-list')).toBeInTheDocument();
    expect(
      screen.getByRole('separator', { name: /изменить ширину списка чатов/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  describe('правая панель (#818)', () => {
    function setReducedMotion(reduce: boolean) {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: reduce && query.includes('reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })) as never;
    }

    function renderPage() {
      const { container } = render(
        <MemoryRouter>
          <ChatsPage />
        </MemoryRouter>
      );
      // Место панели — единственный элемент с состоянием на странице.
      const slot = container.querySelector('[data-state]')!;
      return { slot };
    }

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('выезжает при открытии профиля и уезжает с анимацией', () => {
      setReducedMotion(false);
      const { slot } = renderPage();

      expect(slot).toHaveAttribute('data-state', 'closed');
      expect(screen.queryByTestId('user-profile-panel')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Открыть профиль' }));
      expect(slot).toHaveAttribute('data-state', 'open');
      expect(screen.getByTestId('user-profile-panel')).toBeInTheDocument();

      // Затемнение закрывает панель — там, где она ложится поверх.
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
      expect(slot).toHaveAttribute('data-state', 'closed');
      // Содержимое остаётся, пока панель уезжает, — иначе уезжала бы пустая рамка.
      expect(screen.getByTestId('user-profile-panel')).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(320));
      expect(screen.queryByTestId('user-profile-panel')).not.toBeInTheDocument();
    });

    it('без анимации закрывается сразу, если движение уменьшено', () => {
      setReducedMotion(true);
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'Открыть профиль' }));
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
      act(() => vi.advanceTimersByTime(0));

      expect(screen.queryByTestId('user-profile-panel')).not.toBeInTheDocument();
    });
  });

  it('рендерит только список чатов в мобильном режиме без выбранного чата', () => {
    mockIsMobile = true;

    render(
      <MemoryRouter>
        <ChatsPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('chats-list')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });
});
