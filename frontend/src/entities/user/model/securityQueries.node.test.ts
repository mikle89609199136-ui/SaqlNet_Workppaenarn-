import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { useProfileStore } from './profileStore';
import { userKeys } from './userKeys';
import { sessionsQuery } from './securityQueries';
import type { IUserDto } from './types';
import type { components } from '@/types/api.generated';

type Session = components['schemas']['AuthSession'];
const row: Session = {
  id: 'session-a',
  isCurrent: true,
  deviceName: 'A',
  deviceType: 'desktop',
  ipAddress: '',
  location: '',
  userAgent: '',
  createdAt: '2026-10-23T00:00:00Z',
  lastActive: '2026-10-23T00:00:00Z',
};
afterEach(() => {
  vi.restoreAllMocks();
  useProfileStore.setState({ user: null, isAuth: false });
});
it('an old session-list response cannot populate another account or another login of the same account', async () => {
  useProfileStore.setState({ user: { id: 'alice' } as IUserDto });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let finish!: (rows: Session[]) => void;
  vi.spyOn(services.authService, 'getSessions').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const first = client.fetchQuery(sessionsQuery()).catch(() => {});
  const keyA = userKeys.sessions();
  useProfileStore.setState({ user: { id: 'bob' } as IUserDto });
  client.setQueryData(userKeys.sessions(), [{ ...row, id: 'session-b' }]);
  finish([row]);
  await first;
  expect(client.getQueryData<Session[]>(userKeys.sessions())?.[0].id).toBe('session-b');
  useProfileStore.setState({ user: null });
  useProfileStore.setState({ user: { id: 'alice' } as IUserDto });
  expect(userKeys.sessions()).not.toEqual(keyA);
  expect(client.getQueryData(userKeys.sessions())).toBeUndefined();
  client.clear();
});
it('cancelling a list fetch ignores its late result even if HTTP cannot be aborted', async () => {
  useProfileStore.setState({ user: { id: 'alice' } as IUserDto });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(userKeys.sessions(), [row]);
  let finish!: (rows: Session[]) => void;
  vi.spyOn(services.authService, 'getSessions').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const first = client.fetchQuery(sessionsQuery()).catch(() => {});
  await client.cancelQueries({ queryKey: userKeys.sessions(), exact: true });
  client.setQueryData(userKeys.sessions(), []);
  finish([row]);
  await first;
  expect(client.getQueryData(userKeys.sessions())).toEqual([]);
  client.clear();
});
