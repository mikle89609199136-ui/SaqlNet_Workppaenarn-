import { useProfileStore } from './profileStore';

let epoch = 0;
useProfileStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) epoch++;
});

/** Logout/login of the same owner is a different session too. Never reuse its responses. */
export function settingsSession() {
  return { ownerId: useProfileStore.getState().user?.id, epoch };
}
export type TSettingsSession = ReturnType<typeof settingsSession>;

export function isSettingsSession(session: TSettingsSession): boolean {
  const current = settingsSession();
  return session.ownerId === current.ownerId && session.epoch === current.epoch;
}
