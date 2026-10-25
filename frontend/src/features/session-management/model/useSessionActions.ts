import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  isSettingsSession,
  settingsSession,
  sessionsQuery,
  userKeys,
  useProfileStore,
} from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { REACT_ROUTES } from '@/shared/config';
import type { IApiError } from '@/shared/api';
import type { components } from '@/types/api.generated';

export type TAuthSession = components['schemas']['AuthSession'];
export type TSessionIntent =
  { kind: 'one'; target: TAuthSession } | { kind: 'others' } | { kind: 'all' };
type TSessionScope = ReturnType<typeof settingsSession>;
interface IOperation {
  intent: TSessionIntent;
  scope: TSessionScope;
}
export type TSessionNotice = 'gone' | 'current' | 'failed' | 'allFailed' | 'refreshFailed';

/** Selective revoke never calls wipeDevice/forgetSession or the logout flow. */
export function useSessionActions(onSignedOut: () => void) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const ownerId = useProfileStore((state) => state.user?.id);
  const renderedScope = settingsSession();
  const [asked, setAsked] = useState<IOperation | null>(null);
  const [notice, setNotice] = useState<{ scope: TSessionScope; value: TSessionNotice } | null>(
    null
  );
  // Native disabled/loading updates on the next render. This also guards two
  // confirmation clicks in the same event loop, including dismiss/reopen.
  const running = useRef<IOperation | null>(null);

  const tell = (operation: IOperation, value: TSessionNotice) => {
    if (isSettingsSession(operation.scope)) setNotice({ scope: operation.scope, value });
  };
  const refresh = async (operation: IOperation, reportFailure: boolean) => {
    if (!isSettingsSession(operation.scope)) return;
    try {
      await client.fetchQuery({ ...sessionsQuery(), retry: false });
    } catch {
      if (reportFailure) tell(operation, 'refreshFailed');
    }
  };
  const removeConfirmed = async (operation: IOperation) => {
    const key = userKeys.sessions(operation.scope);
    await client.cancelQueries({ queryKey: key, exact: true });
    if (!isSettingsSession(operation.scope)) return;
    client.setQueryData<TAuthSession[]>(key, (current) =>
      current?.filter((row) =>
        operation.intent.kind === 'one'
          ? row.id !== operation.intent.target.id
          : row.isCurrent !== false
      )
    );
  };

  const mutation = useMutation<void, IApiError, IOperation>({
    mutationKey: [...userKeys.sessions(), 'terminate'],
    mutationFn: async (operation) => {
      if (!isSettingsSession(operation.scope))
        throw new DOMException('Session changed', 'AbortError');
      await client.cancelQueries({ queryKey: userKeys.sessions(operation.scope), exact: true });
      if (!isSettingsSession(operation.scope))
        throw new DOMException('Session changed', 'AbortError');
      if (operation.intent.kind === 'one') {
        const target = operation.intent.target;
        const cached = client
          .getQueryData<TAuthSession[]>(userKeys.sessions(operation.scope))
          ?.find((row) => row.id === target.id);
        if (target.isCurrent !== false || cached?.isCurrent === true)
          throw Object.assign(new Error('Current session'), {
            status: 409,
            code: 'conflict_current_session',
          });
        await services.userService.deleteDevice(target.id);
      } else if (operation.intent.kind === 'others') {
        await services.userService.terminateAllDevices();
      } else {
        await services.authService.logoutAll();
      }
    },
    onSuccess: async (_data, operation) => {
      if (!isSettingsSession(operation.scope)) return;
      if (operation.intent.kind === 'all') {
        // This existing action explicitly includes this device and erases its
        // keys. Only the selective actions preserve the current session.
        await services.cryptoService.wipeDevice().catch(() => {});
        if (!isSettingsSession(operation.scope)) return;
        onSignedOut();
        navigate(REACT_ROUTES.LOGIN, { replace: true });
      } else {
        await removeConfirmed(operation);
        await refresh(operation, true);
      }
    },
    onError: async (error, operation) => {
      if (!isSettingsSession(operation.scope)) return;
      if (error.status === 401) {
        // The app's global 401 handler may already have cleared the session.
        // Standalone settings screens use the same supplied cleanup flow.
        onSignedOut();
        navigate(REACT_ROUTES.LOGIN, { replace: true });
        return;
      }
      if (operation.intent.kind === 'one' && error.status === 404) {
        await removeConfirmed(operation);
        tell(operation, 'gone');
      } else if (operation.intent.kind === 'one' && error.status === 409) {
        tell(operation, 'current');
      } else {
        tell(operation, operation.intent.kind === 'all' ? 'allFailed' : 'failed');
      }
      if (operation.intent.kind !== 'all') await refresh(operation, false);
    },
    onSettled: (_data, _error, operation) => {
      if (running.current === operation) running.current = null;
      setAsked((value) => (value === operation ? null : value));
    },
  });

  const busy = mutation.isPending;
  return {
    asked: asked && isSettingsSession(asked.scope) ? asked.intent : null,
    notice: notice && isSettingsSession(notice.scope) ? notice.value : null,
    busy,
    clearNotice() {
      if (isSettingsSession(renderedScope)) setNotice(null);
    },
    ask(intent: TSessionIntent) {
      if (!ownerId || (running.current && isSettingsSession(running.current.scope))) return;
      mutation.reset();
      setNotice(null);
      setAsked({ intent, scope: settingsSession() });
    },
    cancel() {
      if (!running.current || !isSettingsSession(running.current.scope)) setAsked(null);
    },
    confirm() {
      if (!asked || !isSettingsSession(asked.scope) || running.current === asked) return;
      if (running.current && isSettingsSession(running.current.scope)) return;
      running.current = asked;
      setNotice(null);
      mutation.mutate(asked);
    },
  };
}
