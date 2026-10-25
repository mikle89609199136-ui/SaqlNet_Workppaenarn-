import { useMutation, useQueryClient, type MutateOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import type { IPrivacyDto, ISettingsDto } from '@/types';
import { userKeys } from '../model/userKeys';
import {
  isSettingsSession,
  settingsSession,
  type TSettingsSession,
} from '../model/settingsSession';
import {
  beginSettingsWrite,
  finishSettingsWrite,
  settingsWritesPending,
  type ISettingsWrite,
  type TSettingsSection,
} from '../model/settingsWrites';
import { refreshSettings, publishSettingsInvalidation } from '../model/settingsSync';

interface IWriteVariables<T> {
  patch: T;
  session: TSettingsSession;
}

/** Flat patches preserve other fields. One local queue preserves click order across hooks.
 * PUT responses are never installed as snapshots: only a new GET after the last write
 * can confirm the canonical state. Rollback removes only that write's optimistic layer.
 */
function usePreferenceMutation<T extends object>(
  section: TSettingsSection,
  send: (patch: T) => Promise<unknown>
) {
  const client = useQueryClient();
  const mutation = useMutation<unknown, Error, IWriteVariables<T>, ISettingsWrite>({
    mutationKey: userKeys.settings(),
    scope: { id: JSON.stringify(userKeys.settings()) },
    mutationFn: ({ patch, session }) => {
      if (!isSettingsSession(session)) throw new DOMException('Session changed', 'AbortError');
      return send(patch);
    },
    onMutate: ({ patch, session }) => beginSettingsWrite(client, session, section, patch),
    onSuccess: (_data, { session }, context) => {
      finishSettingsWrite(client, context, true);
      if (isSettingsSession(session) && session.ownerId)
        publishSettingsInvalidation(session.ownerId);
    },
    onError: (_error, _variables, context) => {
      if (context) finishSettingsWrite(client, context, false);
    },
    onSettled: async (_data, _error, { session }) => {
      if (isSettingsSession(session) && !settingsWritesPending(client, session))
        await refreshSettings(client, session);
    },
  });

  type Options = MutateOptions<unknown, Error, T, ISettingsWrite>;
  const optionsFor = (
    options?: Options
  ): MutateOptions<unknown, Error, IWriteVariables<T>, ISettingsWrite> => ({
    onSuccess: (data, variables, ...rest) => {
      if (isSettingsSession(variables.session))
        options?.onSuccess?.(data, variables.patch, ...rest);
    },
    onError: (error, variables, ...rest) => {
      if (isSettingsSession(variables.session)) options?.onError?.(error, variables.patch, ...rest);
    },
    onSettled: (data, error, variables, ...rest) => {
      if (isSettingsSession(variables.session))
        options?.onSettled?.(data, error, variables.patch, ...rest);
    },
  });
  return {
    ...mutation,
    variables: mutation.variables?.patch,
    mutate: (patch: T, options?: Options) =>
      mutation.mutate({ patch, session: settingsSession() }, optionsFor(options)),
    mutateAsync: (patch: T, options?: Options) =>
      mutation.mutateAsync({ patch, session: settingsSession() }, optionsFor(options)),
  };
}

export function useUpdateSettings() {
  return usePreferenceMutation('settings', (patch: Partial<ISettingsDto>) =>
    services.userService.updateSettings(patch)
  );
}
export function useUpdatePrivacy() {
  return usePreferenceMutation('privacy', (patch: Partial<IPrivacyDto>) =>
    services.userService.updatePrivacy(patch)
  );
}
