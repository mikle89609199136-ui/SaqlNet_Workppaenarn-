import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { services } from '@/services/serviceContainer';
import { makeUser } from '@/test/fixtures';
import { userKeys } from '../model/userKeys';
import { useProfileStore } from '../model/profileStore';
import { useUpdateSettings, useUpdatePrivacy } from './settingsMutations';

const pending = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
let client: QueryClient;
beforeEach(() => {
  useProfileStore.setState({ user: makeUser({ id: 'alice' }), isAuth: true });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(userKeys.settings(), {
    settings: { theme: 'dark' },
    privacy: { calls: 'all' },
  });
});
afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('serializes settings/privacy requests and rolls back only the failed layer', async () => {
  const first = pending<unknown>(),
    second = pending<unknown>();
  const settings = vi.spyOn(services.userService, 'updateSettings').mockReturnValue(first.promise);
  const privacy = vi.spyOn(services.userService, 'updatePrivacy').mockReturnValue(second.promise);
  vi.spyOn(services.userService, 'getSettings').mockResolvedValue({
    settings: { theme: 'dark' },
    privacy: { calls: 'nobody' },
  });
  const { result } = renderHook(
    () => ({ settings: useUpdateSettings(), privacy: useUpdatePrivacy() }),
    { wrapper }
  );
  act(() => {
    result.current.settings.mutate({ theme: 'light' });
    result.current.privacy.mutate({ calls: 'nobody' });
  });
  await waitFor(() => expect(settings).toHaveBeenCalledOnce());
  expect(privacy).not.toHaveBeenCalled();
  expect(client.getQueryData(userKeys.settings())).toEqual({
    settings: { theme: 'light' },
    privacy: { calls: 'nobody' },
  });
  first.reject(new Error('failed PUT'));
  await waitFor(() => expect(privacy).toHaveBeenCalledOnce());
  expect(client.getQueryData(userKeys.settings())).toEqual({
    settings: { theme: 'dark' },
    privacy: { calls: 'nobody' },
  });
  second.resolve({ calls: 'nobody' });
  await waitFor(() => expect(result.current.privacy.isSuccess).toBe(true));
  expect(client.getQueryData(userKeys.settings())).toEqual({
    settings: { theme: 'dark' },
    privacy: { calls: 'nobody' },
  });
});

it('does not send a queued write or invoke its callbacks after account switch', async () => {
  const first = pending<unknown>();
  const settings = vi.spyOn(services.userService, 'updateSettings').mockReturnValue(first.promise);
  const onSuccess = vi.fn();
  const { result } = renderHook(() => useUpdateSettings(), { wrapper });
  act(() => {
    result.current.mutate({ theme: 'light' });
    result.current.mutate({ palette: 'warm' }, { onSuccess });
  });
  await waitFor(() => expect(settings).toHaveBeenCalledOnce());
  act(() => useProfileStore.setState({ user: makeUser({ id: 'bob' }) }));
  client.setQueryData(userKeys.settings(), { settings: { theme: 'dark' }, privacy: {} });
  first.resolve({ theme: 'light' });
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(settings).toHaveBeenCalledOnce();
  expect(onSuccess).not.toHaveBeenCalled();
  expect(client.getQueryData(userKeys.settings())).toEqual({
    settings: { theme: 'dark' },
    privacy: {},
  });
});
