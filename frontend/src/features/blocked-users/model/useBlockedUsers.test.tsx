import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { services } from '@/services/serviceContainer';
import { testI18n } from '@/test/harness/i18n';
import { clearToasts, getToasts } from '@/shared/ui';
import { useBlockedUsers } from './useBlockedUsers';
import { useBlockUserMutation } from './useBlockUserMutation';
import { useUnblockUserMutation } from './useUnblockUserMutation';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('useBlockedUsers и мутации блокировки', () => {
  beforeEach(() => {
    clearToasts();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearToasts();
    vi.restoreAllMocks();
  });

  it('должен возвращать список заблокированных и проверять isUserBlocked', async () => {
    vi.spyOn(services.userService, 'listBlocked').mockResolvedValue([
      {
        id: 'u-1',
        username: 'user_one',
        firstName: 'User',
        lastName: 'One',
        avatarUrl: '',
        blockedAt: '2026-01-01',
      },
    ]);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.blockedUsers).toHaveLength(1);
    expect(result.current.blockedCount).toBe(1);
    expect(result.current.isUserBlocked('u-1')).toBe(true);
    expect(result.current.isUserBlocked('u-2')).toBe(false);
    expect(result.current.isUserBlocked(null)).toBe(false);
  });

  it('useBlockUserMutation должен блокировать пользователя и показывать тост', async () => {
    vi.spyOn(services.userService, 'blockUser').mockResolvedValue({ success: true });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useBlockUserMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        userId: 'u-target',
        user: { username: 'target_user' },
      });
    });

    expect(services.userService.blockUser).toHaveBeenCalledWith('u-target');
    const toasts = getToasts();
    expect(toasts.some((t) => t.type === 'success')).toBe(true);
  });

  it('useBlockUserMutation должен показывать ошибку при падении запроса', async () => {
    vi.spyOn(services.userService, 'blockUser').mockRejectedValue({
      code: 'already_blocked',
      message: 'user is already blocked',
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useBlockUserMutation(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ userId: 'u-target' });
      } catch {
        // ожидаемый выброс ошибки мутации
      }
    });

    const toasts = getToasts();
    expect(toasts.some((t) => t.type === 'error')).toBe(true);
  });

  it('useUnblockUserMutation должен разблокировать пользователя и показывать тост', async () => {
    vi.spyOn(services.userService, 'unblockUser').mockResolvedValue({ success: true });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useUnblockUserMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('u-target');
    });

    expect(services.userService.unblockUser).toHaveBeenCalledWith('u-target');
    const toasts = getToasts();
    expect(toasts.some((t) => t.type === 'success')).toBe(true);
  });
});
