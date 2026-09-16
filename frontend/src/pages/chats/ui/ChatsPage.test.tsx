import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    Outlet: () => <div data-testid="outlet">Контент треда</div>,
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
