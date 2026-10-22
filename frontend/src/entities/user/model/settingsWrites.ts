import type { QueryClient } from '@tanstack/react-query';
import type { ISettingsPayloadDto } from './types';
import { isSettingsSession, type TSettingsSession } from './settingsSession';
import { userKeys } from './userKeys';

export type TSettingsSection = 'settings' | 'privacy';
export interface ISettingsWrite {
  session: TSettingsSession;
  section: TSettingsSection;
  patch: object;
  batch: IWriteBatch;
}
interface IWriteBatch {
  base: ISettingsPayloadDto | undefined;
  writes: ISettingsWrite[];
}
const batches = new WeakMap<QueryClient, Map<string, IWriteBatch>>();
const batchKey = (session: TSettingsSession) => JSON.stringify(userKeys.settings(session));
function store(client: QueryClient) {
  let value = batches.get(client);
  if (!value) batches.set(client, (value = new Map()));
  return value;
}
function apply(base: ISettingsPayloadDto | undefined, section: TSettingsSection, patch: object) {
  return {
    settings: base?.settings ?? {},
    privacy: base?.privacy ?? {},
    [section]: { ...base?.[section], ...patch },
  } as ISettingsPayloadDto;
}
function paint(client: QueryClient, write: ISettingsWrite) {
  if (!isSettingsSession(write.session)) return;
  const next = write.batch.writes.reduce(
    (base, pending) => apply(base, pending.section, pending.patch),
    write.batch.base
  );
  if (next === undefined)
    client.removeQueries({ queryKey: userKeys.settings(write.session), exact: true });
  else client.setQueryData(userKeys.settings(write.session), next);
}
export function settingsWritesPending(client: QueryClient, session?: TSettingsSession) {
  if (session) return (store(client).get(batchKey(session))?.writes.length ?? 0) > 0;
  return [...store(client).values()].some((batch) => batch.writes.length > 0);
}
export async function beginSettingsWrite(
  client: QueryClient,
  session: TSettingsSession,
  section: TSettingsSection,
  patch: object
): Promise<ISettingsWrite> {
  if (!isSettingsSession(session)) throw new DOMException('Session changed', 'AbortError');
  const key = batchKey(session);
  let batch = store(client).get(key);
  if (!batch) {
    batch = { base: client.getQueryData(userKeys.settings(session)), writes: [] };
    store(client).set(key, batch);
  }
  // Register in click order before awaiting cancellation (onMutate can overlap).
  const write = { session, section, patch, batch };
  batch.writes.push(write);
  await client.cancelQueries({ queryKey: userKeys.settings(session), exact: true });
  paint(client, write);
  return write;
}
export function finishSettingsWrite(
  client: QueryClient,
  write: ISettingsWrite,
  succeeded: boolean
) {
  if (succeeded) write.batch.base = apply(write.batch.base, write.section, write.patch);
  write.batch.writes = write.batch.writes.filter((item) => item !== write);
  paint(client, write);
  if (!write.batch.writes.length) store(client).delete(batchKey(write.session));
}
