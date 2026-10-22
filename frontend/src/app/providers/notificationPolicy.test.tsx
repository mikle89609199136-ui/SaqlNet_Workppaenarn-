import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/shared/api';
import { userKeys, useProfileStore } from '@/entities/user';
import { chatKeys } from '@/entities/chat';
import { useCallStore } from '@/features/call';
import { usePushStore } from '@/features/push-notifications';
import { services } from '@/services/serviceContainer';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { fakeSocket } from '@/test/harness/fakeSocket';
import * as sound from '@/shared/lib/notifications/messageSound';
import { NotificationManager } from './NotificationManager';

let stored: { notifications: boolean; sounds: boolean; callSounds: boolean };
let chat = makeChat({ id: 'policy-chat', isMuted: false });
let system: ReturnType<typeof vi.fn>;
let permission: NotificationPermission;
let foreground: boolean;
const close = vi.fn();

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', undefined);
  stored = { notifications: true, sounds: true, callSounds: true };
  chat = makeChat({ id: 'policy-chat', isMuted: false });
  foreground = false;
  permission = 'granted';
  close.mockClear();
  system = vi.fn(function () {
    return { close };
  });
  Object.defineProperty(system, 'permission', { get: () => permission });
  vi.stubGlobal('Notification', system);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => !foreground);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    foreground ? 'visible' : 'hidden'
  );
  vi.spyOn(document, 'hasFocus').mockImplementation(() => foreground);
  vi.spyOn(services.userService, 'getSettings').mockImplementation(async () => ({
    settings: stored,
    privacy: {},
  }));
  vi.spyOn(services.chatService, 'getChat').mockImplementation(async () => ({ ...chat }));
  vi.spyOn(sound, 'playMessageSound').mockResolvedValue(undefined);
  vi.spyOn(sound, 'stopMessageSound').mockImplementation(() => {});
  useProfileStore.setState({ isAuth: true, user: makeUser({ id: 'policy-viewer' }) });
  queryClient.setQueryData(userKeys.settings(), { settings: stored, privacy: {} });
  usePushStore.setState({ status: 'off', subscriptionId: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});
async function emit() {
  await act(async () =>
    fakeSocket.emit('new_message', {
      message: makeMessage({
        id: 'policy-message',
        chatId: chat.id,
        content: 'Секретный текст',
        senderId: 'sender',
        senderName: 'Анна',
      }),
    })
  );
}

const backgroundCases = [false, true].flatMap((notifications) =>
  [false, true].flatMap((sounds) =>
    [false, true].flatMap((muted) =>
      [false, true].flatMap((push) =>
        ['granted', 'default', 'denied'].map((permission) => ({
          notifications,
          sounds,
          muted,
          push,
          permission: permission as NotificationPermission,
        }))
      )
    )
  )
);
describe('Фоновые уведомления сообщений #725', () => {
  it.each(backgroundCases)(
    'N=$notifications S=$sounds M=$muted push=$push permission=$permission',
    async (item) => {
      Object.assign(stored, item);
      chat.isMuted = item.muted;
      permission = item.permission;
      render(<NotificationManager />);
      if (item.push) act(() => usePushStore.setState({ status: 'on', subscriptionId: 'sub' }));
      await emit();
      const allowed =
        item.notifications && !item.muted && !item.push && item.permission === 'granted';
      expect(system).toHaveBeenCalledTimes(allowed ? 1 : 0);
      if (allowed)
        expect(system.mock.calls[0][1]).toMatchObject({
          body: 'Секретный текст',
          silent: !item.sounds,
          tag: `chat:${chat.id}`,
        });
      expect(sound.playMessageSound).not.toHaveBeenCalled();
    }
  );
});
const foregroundCases = [false, true].flatMap((notifications) =>
  [false, true].flatMap((sounds) =>
    [false, true].flatMap((muted) =>
      [false, true].map((active) => ({ notifications, sounds, muted, active }))
    )
  )
);
describe('Звук сообщений на переднем плане #725', () => {
  it.each(foregroundCases)('N=$notifications S=$sounds M=$muted active=$active', async (item) => {
    Object.assign(stored, item);
    chat.isMuted = item.muted;
    foreground = true;
    permission = 'denied';
    window.history.replaceState(null, '', item.active ? `/chats/${chat.id}` : '/chats/other');
    render(<NotificationManager />);
    await emit();
    expect(sound.playMessageSound).toHaveBeenCalledTimes(
      item.notifications && item.sounds && !item.muted && !item.active ? 1 : 0
    );
    expect(system).not.toHaveBeenCalled();
  });
});

describe('гонки, повторные события и безопасный допуск', () => {
  it('не принимает profileStore как источник при ошибке settings GET', async () => {
    useProfileStore.setState({
      settings: { notifications: true, sounds: true, callSounds: true } as never,
    });
    vi.mocked(services.userService.getSettings).mockRejectedValue(new Error('offline'));
    render(<NotificationManager />);
    await emit();
    expect(system).not.toHaveBeenCalled();
    expect(sound.playMessageSound).not.toHaveBeenCalled();
  });
  it('не дублирует new_message и не показывает своё сообщение', async () => {
    render(<NotificationManager />);
    await emit();
    await emit();
    expect(system).toHaveBeenCalledTimes(1);
    await act(async () =>
      fakeSocket.emit('new_message', {
        message: makeMessage({ id: 'own', chatId: chat.id, senderId: 'policy-viewer' }),
      })
    );
    expect(system).toHaveBeenCalledTimes(1);
  });
  it('смена foreground на background во время чтения не теряет входящее сообщение', async () => {
    foreground = true;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(services.chatService.getChat).mockImplementation(async () => {
      await gate;
      return { ...chat };
    });
    render(<NotificationManager />);
    await emit();
    await act(async () => {
      foreground = false;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });
    await act(async () => finish());
    expect(system).toHaveBeenCalledTimes(1);
  });
  it('не выдаёт уведомление после logout во время decrypt', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(services.messageService, 'processLastMessageForDisplay').mockImplementation(
      async (_id, message) => {
        await gate;
        return { ...message, content: 'plaintext' };
      }
    );
    render(<NotificationManager />);
    await emit();
    act(() => useProfileStore.setState({ isAuth: false, user: null }));
    await act(async () => finish());
    expect(system).not.toHaveBeenCalled();
  });
  it('не разрешает поздний plaintext после global off во время decrypt', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(services.messageService, 'processLastMessageForDisplay').mockImplementation(
      async (_id, message) => {
        await gate;
        return { ...message, content: 'plaintext' };
      }
    );
    render(<NotificationManager />);
    await emit();
    act(() =>
      queryClient.setQueryData(userKeys.settings(), {
        settings: { notifications: false },
        privacy: {},
      })
    );
    await act(async () => finish());
    expect(system).not.toHaveBeenCalled();
  });
  it('учитывает optimistic mute, даже если сервер ещё возвращает старое false', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const mutation = queryClient
      .getMutationCache()
      .build(queryClient, { mutationKey: ['chat', 'mute'], mutationFn: async () => gate });
    const pending = mutation.execute({ chat });
    queryClient.setQueryData(chatKeys.detail(chat.id), { ...chat, isMuted: true });
    render(<NotificationManager />);
    await emit();
    expect(system).not.toHaveBeenCalled();
    finish();
    await pending;
  });
  it('пока preview сохраняется, plaintext не выдаётся даже при старом false сервера', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: ['chat', 'notification-preview'],
      mutationFn: async () => gate,
    });
    const pending = mutation.execute(chat);
    render(<NotificationManager />);
    await emit();
    expect(system).toHaveBeenCalledTimes(1);
    expect(system.mock.calls[0][1].body).toBe('Новое сообщение');
    finish();
    await pending;
  });
  it('push, включённый во время decrypt, исключает fallback дубль', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(services.messageService, 'processLastMessageForDisplay').mockImplementation(
      async (_id, message) => {
        await gate;
        return { ...message, content: 'plaintext' };
      }
    );
    render(<NotificationManager />);
    await emit();
    act(() => usePushStore.setState({ status: 'on', subscriptionId: 'sub' }));
    await act(async () => finish());
    expect(system).not.toHaveBeenCalled();
  });
  it('истёкший mute не подавляет новое сообщение', async () => {
    chat.isMuted = true;
    chat.mutedUntil = new Date(Date.now() - 1000).toISOString();
    render(<NotificationManager />);
    await emit();
    expect(system).toHaveBeenCalledTimes(1);
  });
  it('пропущенный звонок независим от mute и всегда тихий', async () => {
    chat.isMuted = true;
    render(<NotificationManager />);
    await act(async () =>
      fakeSocket.emit('new_message', {
        message: makeMessage({
          id: 'missed',
          chatId: chat.id,
          senderId: 'sender',
          type: 'call',
          content: JSON.stringify({ status: 'missed', callKind: 'audio', initiatorId: 'sender' }),
        }),
      })
    );
    expect(system).toHaveBeenCalledTimes(1);
    expect(system.mock.calls[0][1]).toMatchObject({ silent: true, body: 'Пропущенный звонок' });
    expect(sound.playMessageSound).not.toHaveBeenCalled();
  });
  it('в видимой, но потерявшей фокус вкладке fallback не теряется при push=on', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    render(<NotificationManager />);
    act(() => usePushStore.setState({ status: 'on', subscriptionId: 'sub' }));
    await emit();
    expect(system).toHaveBeenCalledTimes(1);
  });
  it('закрывает уже показанный fallback при global off', async () => {
    render(<NotificationManager />);
    await emit();
    act(() =>
      queryClient.setQueryData(userKeys.settings(), {
        settings: { notifications: false },
        privacy: {},
      })
    );
    expect(close).toHaveBeenCalled();
  });
});

describe('call notification после room/privacy validation', () => {
  it.each(
    [false, true].flatMap((notifications) =>
      [false, true].map((callSounds) => ({ notifications, callSounds }))
    )
  )('N=$notifications C=$callSounds; M=true/S=false не подавляют вызов', async (flags) => {
    Object.assign(stored, flags, { sounds: false });
    chat.isMuted = true;
    queryClient.setQueryData(userKeys.settings(), { settings: stored, privacy: {} });
    useCallStore.setState({
      incomingAlertsReady: true,
      incomingCall: {
        roomId: 'room',
        from: 'sender',
        fromName: 'Проверенное имя',
        chatId: chat.id,
        kind: 'video',
      },
    });
    const view = render(<NotificationManager />);
    await act(async () => undefined);
    expect(system).toHaveBeenCalledTimes(flags.notifications ? 1 : 0);
    if (flags.notifications)
      expect(system.mock.calls[0]).toEqual([
        'Проверенное имя',
        expect.objectContaining({
          silent: !flags.callSounds,
          tag: 'call:room',
          body: 'Входящий видеозвонок',
        }),
      ]);
    act(() => useCallStore.setState({ incomingCall: null }));
    if (flags.notifications) expect(close).toHaveBeenCalled();
    view.unmount();
  });
  it('сырой call_incoming не создаёт alert', async () => {
    render(<NotificationManager />);
    await act(async () =>
      fakeSocket.emit('call_incoming', {
        roomId: 'forged',
        from: 'someone',
        fromName: 'Непроверенное имя',
        kind: 'video',
      })
    );
    expect(system).not.toHaveBeenCalled();
  });
});
