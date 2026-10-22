import type { QueryClient } from '@tanstack/react-query';
import { settingsQuery } from './settingsQuery';
import { isSettingsSession, settingsSession, type TSettingsSession } from './settingsSession';
import { settingsWritesPending } from './settingsWrites';
import { userKeys } from './userKeys';
import { STORAGE_KEYS } from '@/shared/config';
import { useProfileStore } from './profileStore';

const CHANNEL = 'craneapp:settings-invalidation:v1';
export const SETTINGS_RECOVERY_MS = 30_000;
export interface ISettingsInvalidation {
  userId: string;
  version: 1;
}

export function isSettingsInvalidation(value: unknown): value is ISettingsInvalidation {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ISettingsInvalidation>;
  return event.version === 1 && typeof event.userId === 'string' && event.userId.length > 0;
}

/** No settings, plaintext or authentication material crosses this transport. */
export function publishSettingsInvalidation(userId: string): void {
  const payload: ISettingsInvalidation = { userId, version: 1 };
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(payload);
    channel.close();
  } catch {
    /* storage events are the fallback */
  }
  try {
    localStorage.setItem(CHANNEL, JSON.stringify({ ...payload, nonce: crypto.randomUUID() }));
    localStorage.removeItem(CHANNEL);
  } catch {
    /* WS and recovery refetch still work with storage disabled. */
  }
}

interface IRefresh {
  session: TSettingsSession;
  timer?: ReturnType<typeof setTimeout>;
  generation: number;
  waiters: (() => void)[];
}
const refreshes = new WeakMap<QueryClient, IRefresh>();
const REFRESH_COALESCE_MS = 50;
/** WS, BroadcastChannel and storage often announce the same commit. Batch their
 * burst into one read, but cancel an older in-flight snapshot immediately.
 */
export function refreshSettings(
  client: QueryClient,
  session: TSettingsSession = settingsSession()
): Promise<void> {
  if (!session.ownerId || !isSettingsSession(session) || settingsWritesPending(client, session))
    return Promise.resolve();
  let state = refreshes.get(client);
  if (
    !state ||
    state.session.ownerId !== session.ownerId ||
    state.session.epoch !== session.epoch
  ) {
    if (state) {
      clearTimeout(state.timer);
      state.waiters.splice(0).forEach((done) => done());
    }
    state = { session, generation: 0, waiters: [] };
    refreshes.set(client, state);
  }
  const refresh = state;
  const generation = ++refresh.generation;
  const cancelled = client.cancelQueries({ queryKey: userKeys.settings(session), exact: true });
  clearTimeout(refresh.timer);
  return new Promise<void>((resolve) => {
    refresh.waiters.push(resolve);
    refresh.timer = setTimeout(async () => {
      await cancelled;
      if (generation !== refresh.generation) return;
      try {
        if (isSettingsSession(session) && !settingsWritesPending(client, session))
          await client.fetchQuery({ ...settingsQuery(), staleTime: 0, retry: false });
      } catch {
        // Keep last confirmed values. Focus/reconnect/recovery will retry.
      } finally {
        if (generation === refresh.generation) refresh.waiters.splice(0).forEach((done) => done());
      }
    }, REFRESH_COALESCE_MS);
  });
}

/** Mounted once per authenticated owner, independent of the settings screen. */
export function startSettingsSync(client: QueryClient, session = settingsSession()): () => void {
  let active = true;
  let queued = false;
  const refresh = () => {
    if (!active || !isSettingsSession(session) || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (active && isSettingsSession(session)) void refreshSettings(client, session);
    });
  };
  const receive = (payload: unknown) => {
    if (isSettingsInvalidation(payload) && payload.userId === session.ownerId) refresh();
  };
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => receive(event.data);
  } catch {
    /* Safari/private mode: storage + WS + recovery. */
  }
  const storage = (event: StorageEvent) => {
    // Cookies and login projection are shared by same-origin tabs. A login/logout
    // in a peer tab invalidates this session too; reload creates a clean runtime
    // for the new identity without deleting that tab's freshly written storage.
    if (event.key === STORAGE_KEYS.USER && active && isSettingsSession(session)) {
      let owner: unknown;
      try {
        owner = event.newValue ? JSON.parse(event.newValue)?.id : null;
      } catch {
        owner = null;
      }
      if (owner !== session.ownerId) {
        active = false;
        useProfileStore.setState({ user: null, isAuth: false });
        client.clear();
        window.location.reload();
      }
      return;
    }
    if (event.key !== CHANNEL || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      /* untrusted storage */
    }
  };
  const visible = () => {
    if (!document.hidden) refresh();
  };
  const periodic = window.setInterval(visible, SETTINGS_RECOVERY_MS);
  window.addEventListener('storage', storage);
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  window.addEventListener('pageshow', visible);
  document.addEventListener('visibilitychange', visible);
  refresh();
  return () => {
    active = false;
    channel?.close();
    window.clearInterval(periodic);
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('online', refresh);
    window.removeEventListener('pageshow', visible);
    document.removeEventListener('visibilitychange', visible);
  };
}
