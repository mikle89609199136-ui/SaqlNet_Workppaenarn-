import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { makeUser } from '@/test/fixtures';
import { useProfileStore } from './profileStore';
import { settingsQuery } from './settingsQuery';
import { settingsSession } from './settingsSession';
import { userKeys } from './userKeys';
import {
  refreshSettings,
  startSettingsSync,
  publishSettingsInvalidation,
  SETTINGS_RECOVERY_MS,
} from './settingsSync';
import { beginSettingsWrite, finishSettingsWrite } from './settingsWrites';

const payload = (theme = 'dark') => ({ settings: { theme }, privacy: {} });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let client: QueryClient;
let stops: (() => void)[];
beforeEach(() => {
  useProfileStore.setState({ user: makeUser({ id: 'alice' }), isAuth: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  stops = [];
});
afterEach(() => {
  stops.forEach((stop) => stop());
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('canonical settings synchronization', () => {
  it('a failed write without an initial snapshot leaves no optimistic cache behind', async () => {
    const write = await beginSettingsWrite(client, settingsSession(), 'settings', {
      theme: 'light',
    });
    finishSettingsWrite(client, write, false);
    expect(client.getQueryData(userKeys.settings())).toBeUndefined();
  });
  it('coalesces concurrent WS/tab/focus signals into one fresh read', async () => {
    const get = vi.spyOn(services.userService, 'getSettings').mockResolvedValue(payload());
    await Promise.all([refreshSettings(client), refreshSettings(client), refreshSettings(client)]);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('cancels an older GET even when the service cannot abort its HTTP request', async () => {
    client.setQueryData(userKeys.settings(), payload());
    const old = deferred<ReturnType<typeof payload>>();
    vi.spyOn(services.userService, 'getSettings')
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(payload('light'));
    const first = client.fetchQuery({ ...settingsQuery(), staleTime: 0 }).catch(() => {});
    await refreshSettings(client);
    old.resolve(payload('dark'));
    await first;
    expect(client.getQueryData(userKeys.settings())).toEqual(payload('light'));
  });
  it('isolates accounts and a logout/login of the same account from late reads', async () => {
    const old = deferred<ReturnType<typeof payload>>();
    vi.spyOn(services.userService, 'getSettings').mockReturnValue(old.promise);
    const session = settingsSession();
    const first = client.fetchQuery(settingsQuery()).catch(() => {});
    useProfileStore.setState({ user: makeUser({ id: 'bob' }) });
    client.setQueryData(userKeys.settings(), payload('light'));
    old.resolve(payload());
    await first;
    expect(client.getQueryData(userKeys.settings())).toEqual(payload('light'));
    useProfileStore.setState({ user: makeUser({ id: 'alice' }) });
    expect(userKeys.settings()).not.toEqual(userKeys.settings(session));
    expect(client.getQueryData(userKeys.settings())).toBeUndefined();
  });
  it('keeps newer optimistic fields when an earlier write fails, then confirms after last write', async () => {
    client.setQueryData(userKeys.settings(), payload());
    const session = settingsSession();
    const first = await beginSettingsWrite(client, session, 'settings', { theme: 'light' });
    const second = await beginSettingsWrite(client, session, 'settings', { palette: 'warm' });
    const get = vi
      .spyOn(services.userService, 'getSettings')
      .mockResolvedValue({ settings: { theme: 'dark', palette: 'warm' }, privacy: {} });
    await refreshSettings(client);
    expect(get).not.toHaveBeenCalled();
    finishSettingsWrite(client, first, false);
    expect(client.getQueryData(userKeys.settings())).toEqual({
      settings: { theme: 'dark', palette: 'warm' },
      privacy: {},
    });
    finishSettingsWrite(client, second, true);
    await refreshSettings(client);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('does not allow a late rollback to populate another owner cache', async () => {
    client.setQueryData(userKeys.settings(), payload());
    const write = await beginSettingsWrite(client, settingsSession(), 'settings', {
      theme: 'light',
    });
    useProfileStore.setState({ user: makeUser({ id: 'bob' }) });
    client.setQueryData(userKeys.settings(), payload('light'));
    finishSettingsWrite(client, write, false);
    expect(client.getQueryData(userKeys.settings())).toEqual(payload('light'));
  });
  it('uses invalidations without settings, guards owner/version, and disposes BroadcastChannel', async () => {
    const channels: {
      name: string;
      onmessage: ((event: { data: unknown }) => void) | null;
      close: ReturnType<typeof vi.fn>;
    }[] = [];
    const sent: unknown[] = [];
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        name: string;
        onmessage = null;
        close = vi.fn();
        constructor(name: string) {
          this.name = name;
          channels.push(this);
        }
        postMessage(value: unknown) {
          sent.push(value);
        }
      }
    );
    const get = vi.spyOn(services.userService, 'getSettings').mockResolvedValue(payload());
    const stop = startSettingsSync(client);
    stops.push(stop);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    channels[0].onmessage?.({ data: { userId: 'bob', version: 1, settings: { theme: 'light' } } });
    channels[0].onmessage?.({ data: { userId: 'alice', version: 2 } });
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(1);
    channels[0].onmessage?.({ data: { userId: 'alice', version: 1 } });
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    publishSettingsInvalidation('alice');
    expect(sent).toEqual([{ userId: 'alice', version: 1 }]);
    expect(channels[1].close).toHaveBeenCalledOnce();
    stop();
    expect(channels[0].close).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('recovers on focus/online and every 30 seconds without a working peer transport', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const get = vi.spyOn(services.userService, 'getSettings').mockResolvedValue(payload());
    stops.push(startSettingsSync(client));
    await vi.advanceTimersByTimeAsync(60);
    expect(get).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60);
    expect(get).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60);
    expect(get).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(SETTINGS_RECOVERY_MS);
    expect(get).toHaveBeenCalledTimes(4);
  });
});
