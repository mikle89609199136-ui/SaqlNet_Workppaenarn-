import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { queryClient } from '@/shared/api';
import {
  DEFAULT_PROFILE_SETTINGS,
  selectCallSounds,
  userKeys,
  useProfileStore,
} from '@/entities/user';
import { getCallSoundsEnabled, useCallSounds } from './useCallSounds';

describe('useCallSounds & getCallSoundsEnabled (#1002)', () => {
  let testQueryClient: QueryClient;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    testQueryClient = new QueryClient();
    queryClient.clear();
    useProfileStore.setState({
      settings: { ...DEFAULT_PROFILE_SETTINGS },
    });
  });

  it('до подтверждённых settings рингтон выключен', () => {
    expect(getCallSoundsEnabled()).toBe(false);

    const { result } = renderHook(() => useCallSounds(), { wrapper });
    expect(result.current).toBe(false);
  });

  it('возвращает true, если sounds: false, но callSounds не задан (#1002)', () => {
    testQueryClient.setQueryData(userKeys.settings(), {
      settings: { sounds: false },
    });
    queryClient.setQueryData(userKeys.settings(), {
      settings: { sounds: false },
    });
    useProfileStore.setState({
      settings: { ...DEFAULT_PROFILE_SETTINGS, sounds: false },
    });

    expect(getCallSoundsEnabled()).toBe(true);

    const { result } = renderHook(() => useCallSounds(), { wrapper });
    expect(result.current).toBe(true);
  });

  it('возвращает false, если звук звонков отключён в кэше запросов (#1002)', () => {
    testQueryClient.setQueryData(userKeys.settings(), {
      settings: { callSounds: false },
    });
    queryClient.setQueryData(userKeys.settings(), {
      settings: { callSounds: false },
    });

    expect(getCallSoundsEnabled()).toBe(false);

    const { result } = renderHook(() => useCallSounds(), { wrapper });
    expect(result.current).toBe(false);
  });

  it('возвращает false, если звук звонков отключён в профиле до загрузки запросов (#1002)', () => {
    useProfileStore.setState({
      settings: { ...DEFAULT_PROFILE_SETTINGS, callSounds: false },
    });

    expect(getCallSoundsEnabled()).toBe(false);

    const { result } = renderHook(() => useCallSounds(), { wrapper });
    expect(result.current).toBe(false);
  });

  it('selectCallSounds корректно извлекает значение с фоллбэком на true', () => {
    expect(selectCallSounds(undefined)).toBe(true);
    expect(selectCallSounds(null)).toBe(true);
    expect(selectCallSounds({})).toBe(true);
    expect(selectCallSounds({ callSounds: false })).toBe(false);
    expect(selectCallSounds({ callSounds: true })).toBe(true);
    expect(selectCallSounds({ sounds: false } as any)).toBe(true);
  });
});
