import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { getNotificationFlags, notificationFlags } from './notificationPolicy';
import { userKeys } from './userKeys';

describe('canonical notification policy #725', () => {
  it.each(
    [false, true].flatMap((notifications) =>
      [false, true].flatMap((sounds) =>
        [false, true].map((callSounds) => ({ notifications, sounds, callSounds }))
      )
    )
  )('N=$notifications S=$sounds C=$callSounds', (settings) => {
    expect(notificationFlags(settings)).toEqual({
      notifications: settings.notifications,
      sounds: settings.notifications && settings.sounds,
      callSounds: settings.notifications && settings.callSounds,
    });
  });
  it('различает отсутствие ответа и отсутствующие flags в валидном ответе', () => {
    expect(notificationFlags()).toEqual({ notifications: false, sounds: false, callSounds: false });
    expect(notificationFlags({})).toEqual({ notifications: true, sounds: true, callSounds: true });
    expect(notificationFlags({ notifications: null } as never).notifications).toBe(false);
    expect(notificationFlags({ sounds: 'true', callSounds: false } as never)).toMatchObject({
      sounds: false,
      callSounds: false,
    });
  });
  it('не включает preferences из профиля/диска без query data', () => {
    expect(getNotificationFlags(new QueryClient())).toEqual({
      notifications: false,
      sounds: false,
      callSounds: false,
    });
  });
  it('S=true до commit не включает звук и не маскирует C', async () => {
    const client = new QueryClient();
    client.setQueryData(userKeys.settings(), {
      settings: { notifications: true, sounds: false, callSounds: true },
      privacy: {},
    });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const mutation = client
      .getMutationCache()
      .build(client, { mutationKey: userKeys.settings(), mutationFn: async () => gate });
    const pending = mutation.execute({ sounds: true });
    client.setQueryData(userKeys.settings(), {
      settings: { notifications: true, sounds: true, callSounds: true },
      privacy: {},
    });
    expect(getNotificationFlags(client)).toEqual({
      notifications: true,
      sounds: false,
      callSounds: true,
    });
    finish();
    await pending;
    expect(getNotificationFlags(client)).toEqual({
      notifications: true,
      sounds: true,
      callSounds: true,
    });
  });
});
