import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:3000';
const PASSWORD = 'Local-725-strong-password!';
const CLOUD = 'Local-725-cloud-password!';

async function register(context: BrowserContext, name: string) {
  await context.grantPermissions(['notifications'], { origin: ORIGIN });
  const response = await context.request.post('/api/v2/auth/register', {
    headers: { Origin: ORIGIN },
    data: {
      username: `notify_${Math.random().toString(36).slice(2, 7)}_${Date.now().toString(36)}`,
      password: PASSWORD,
      firstName: name,
      language: 'ru',
    },
  });
  expect(response.status()).toBe(201);
  const { user } = await response.json();
  await context.addInitScript((user) => {
    localStorage.setItem('craneapp_user_data', JSON.stringify(user));
    const probe = {
      notifications: [] as { title: string; options: NotificationOptions; closed: boolean }[],
      oscillators: 0,
      received: 0,
    };
    Object.assign(window, { notificationProbe: probe });
    // Headless macOS: browser permission granted, но native Notification.permission=denied.
    // Перехват системного renderer фиксирует допуск и payload; реальный OS звук здесь не проверяется.
    window.Notification = class {
      static get permission() {
        return 'granted' as NotificationPermission;
      }
      static requestPermission() {
        return Promise.resolve('granted' as NotificationPermission);
      }
      entry: { title: string; options: NotificationOptions; closed: boolean };
      constructor(title: string, options: NotificationOptions) {
        this.entry = { title, options, closed: false };
        probe.notifications.push(this.entry);
      }
      close() {
        this.entry.closed = true;
      }
    } as unknown as typeof Notification;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      createOscillator() {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (...args) => {
          probe.oscillators++;
          start(...args);
        };
        return oscillator;
      }
    };
  }, user);
  return user as { id: string; firstName: string };
}

async function open(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('/chats');
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  // Свежий аккаунт проходит тот же обязательный backup flow, что настоящий пользователь.
  const cloud = page.getByRole('textbox', { name: 'Облачный пароль', exact: true });
  await expect(cloud.or(page.getByRole('link', { name: 'Настройки', exact: true }))).toBeVisible();
  if (await cloud.isVisible()) {
    await cloud.fill(CLOUD);
    const repeat = page.getByRole('textbox', { name: 'Повторите облачный пароль', exact: true });
    if (await repeat.isVisible()) await repeat.fill(CLOUD);
    await page.getByRole('button', { name: /^(Сохранить|Открыть историю|Открыть)$/ }).click();
    const later = page.getByRole('button', { name: 'Позже', exact: true });
    await expect(
      later.or(page.getByRole('link', { name: 'Настройки', exact: true }))
    ).toBeVisible();
    if (await later.isVisible()) await later.click();
  }
  await page.evaluate(async () => {
    // @ts-expect-error Браузер загружает production module через Vite.
    const { eventBus } = await import('/src/shared/lib/event-bus/index.ts');
    eventBus.on('new_message', () => {
      (window as unknown as { notificationProbe: { received: number } }).notificationProbe
        .received++;
    });
  });
  return page;
}

async function presence(page: Page, foreground: boolean, hidden = !foreground) {
  await page.evaluate(
    ({ foreground, hidden }) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (hidden ? 'hidden' : 'visible'),
      });
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => foreground });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event(foreground ? 'focus' : 'blur'));
    },
    { foreground, hidden }
  );
}
const observed = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          notificationProbe: {
            notifications: { title: string; options: NotificationOptions; closed: boolean }[];
            oscillators: number;
            received: number;
          };
        }
      ).notificationProbe
  );
async function send(page: Page, text: string) {
  const editor = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await expect(editor).toBeEditable();
  await editor.fill(text);
  await editor.press('Enter');
  await expect(page.getByText(text, { exact: true }).last()).toBeVisible();
}
async function toggle(page: Page, name: string) {
  const control = page.getByRole('switch', { name, exact: true });
  await expect(control).toBeEnabled();
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/users/settings') && response.request().method() === 'PUT'
  );
  await page.getByText(name, { exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(control).toBeEnabled();
}

test('настройки → сообщения → mute/preview → звонки → две вкладки', async ({ browser }) => {
  const senderContext = await browser.newContext({ baseURL: ORIGIN });
  const receiverContext = await browser.newContext({ baseURL: ORIGIN });
  try {
    const senderUser = await register(senderContext, 'Отправитель');
    const receiverUser = await register(receiverContext, 'Получатель');
    const sender = await open(senderContext);
    const receiver = await open(receiverContext);
    const created = await senderContext.request.post('/api/v2/chats/private', {
      headers: { Origin: ORIGIN },
      data: { userId: receiverUser.id },
    });
    expect(created.ok()).toBe(true);
    const { chatId } = await created.json();
    await sender.goto(`/chats/${chatId}`);
    await receiver.goto(`/chats/${chatId}`);
    // probe переустанавливается после document navigation.
    for (const page of [sender, receiver])
      await page.evaluate(async () => {
        // @ts-expect-error Production module served by Vite.
        const { eventBus } = await import('/src/shared/lib/event-bus/index.ts');
        eventBus.on('new_message', () => {
          (window as unknown as { notificationProbe: { received: number } }).notificationProbe
            .received++;
        });
      });
    await presence(receiver, true);
    await send(sender, '725: открытый активный чат');
    await expect(
      receiver.getByText('725: открытый активный чат', { exact: true }).last()
    ).toBeVisible();
    expect((await observed(receiver)).notifications).toHaveLength(0);
    expect((await observed(receiver)).oscillators).toBe(0);

    await receiver.goto('/settings/notifications');
    await presence(receiver, true);
    await send(sender, '725: звук другого чата');
    await expect.poll(async () => (await observed(receiver)).oscillators).toBeGreaterThan(0);
    await toggle(receiver, 'Уведомления');
    const beforeOff = await observed(receiver);
    await send(sender, '725: global off');
    await receiver.waitForTimeout(300);
    expect((await observed(receiver)).notifications).toHaveLength(0);
    expect((await observed(receiver)).oscillators).toBe(beforeOff.oscillators);
    await toggle(receiver, 'Уведомления');
    await toggle(receiver, 'Звуки сообщений');
    await presence(receiver, false);
    await send(sender, '725: тихое системное уведомление');
    await expect.poll(async () => (await observed(receiver)).notifications.length).toBe(1);
    expect((await observed(receiver)).notifications[0].options).toMatchObject({
      silent: true,
      body: '725: тихое системное уведомление',
    });

    // Реальное меню и API mute. Рингтон и callSounds при этом сохраняются.
    await presence(receiver, true);
    await receiver.goto('/chats');
    const row = receiver.locator(`a[href="/chats/${chatId}"]`).first();
    await row.click({ button: 'right' });
    const muted = receiver.waitForResponse(
      (response) =>
        response.url().endsWith(`/chats/${chatId}/mute`) && response.request().method() === 'POST'
    );
    await receiver.getByRole('menuitem', { name: 'Отключить уведомления', exact: true }).click();
    expect((await muted).ok()).toBe(true);
    expect(
      (await (await receiverContext.request.get(`/api/v2/chats/${chatId}`)).json()).chat.isMuted
    ).toBe(true);
    await presence(receiver, false);
    const mutedBefore = await observed(receiver);
    await send(sender, '725: muted message');
    await receiver.waitForTimeout(300);
    expect((await observed(receiver)).notifications.length).toBe(mutedBefore.notifications.length);

    const call = async () =>
      sender.evaluate(
        async ({ chatId, peerId }) => {
          // @ts-expect-error Production module served by Vite.
          const { useCallStore } = await import('/src/features/call/model/callStore.ts');
          await useCallStore.getState().initiateCall(chatId, 'p2p', 'Звонок', 'audio', peerId);
        },
        { chatId, peerId: receiverUser.id }
      );
    await call();
    await expect
      .poll(
        async () =>
          (await observed(receiver)).notifications.filter((entry) =>
            entry.options.tag?.startsWith('call:')
          ).length
      )
      .toBe(1);
    const callAlert = (await observed(receiver)).notifications.find((entry) =>
      entry.options.tag?.startsWith('call:')
    )!;
    expect(callAlert.title).toBe(senderUser.firstName);
    expect(callAlert.options.silent).toBe(false);
    expect((await observed(receiver)).oscillators).toBe(0);
    await sender.evaluate(async () => {
      // @ts-expect-error Production module served by Vite.
      const { useCallStore } = await import('/src/features/call/model/callStore.ts');
      useCallStore.getState().cancelCall();
    });
    await expect
      .poll(
        async () =>
          (await observed(receiver)).notifications.find((entry) =>
            entry.options.tag?.startsWith('call:')
          )?.closed
      )
      .toBe(true);

    // Preview скрыт: даже расшифровываемый plaintext не выходит в ОС.
    expect(
      (
        await receiverContext.request.delete(`/api/v2/chats/${chatId}/mute`, {
          headers: { Origin: ORIGIN },
        })
      ).ok()
    ).toBe(true);
    expect(
      (
        await receiverContext.request.put(`/api/v2/chats/${chatId}/notification-settings`, {
          headers: { Origin: ORIGIN },
          data: { hideNotificationPreview: true },
        })
      ).ok()
    ).toBe(true);
    const second = await open(receiverContext);
    await presence(receiver, false);
    await presence(second, false);
    await send(sender, '725: plaintext запрещён в двух вкладках');
    await expect
      .poll(
        async () =>
          (await observed(receiver)).notifications.filter(
            (entry) =>
              entry.options.tag === `chat:${chatId}` &&
              entry.options.body === 'Новое сообщение' &&
              !entry.closed
          ).length +
          (await observed(second)).notifications.filter(
            (entry) =>
              entry.options.tag === `chat:${chatId}` &&
              entry.options.body === 'Новое сообщение' &&
              !entry.closed
          ).length
      )
      .toBe(1);
    const messageAlerts = [
      ...(await observed(receiver)).notifications,
      ...(await observed(second)).notifications,
    ].filter(
      (entry) =>
        entry.options.tag === `chat:${chatId}` &&
        entry.options.body === 'Новое сообщение' &&
        !entry.closed
    );
    expect(messageAlerts[0].options.body).toBe('Новое сообщение');

    // Background получает событие раньше foreground; активный чат всё равно подавляет alert.
    await presence(second, true);
    await second.goto(`/chats/${chatId}`);
    await presence(second, true);
    const oldCount = (await observed(receiver)).notifications.length;
    await send(sender, '725: активная вкладка имеет приоритет');
    await expect(
      second.getByText('725: активная вкладка имеет приоритет', { exact: true }).last()
    ).toBeVisible();
    await receiver.waitForTimeout(300);
    expect((await observed(receiver)).notifications.length).toBe(oldCount);
    expect((await observed(second)).notifications.length).toBe(0);
  } finally {
    await senderContext.close();
    await receiverContext.close();
  }
});
