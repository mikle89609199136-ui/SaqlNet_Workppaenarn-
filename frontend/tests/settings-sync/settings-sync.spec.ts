import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:3000';
const PASSWORD = 'Local-1041-password!';
const CLOUD = 'Local-1041-cloud!';
async function identity(context: BrowserContext, existing?: string) {
  const username =
    existing ?? `sync_${Math.random().toString(36).slice(2, 7)}_${Date.now().toString(36)}`;
  const response = await context.request.post(`/api/v2/auth/${existing ? 'login' : 'register'}`, {
    headers: { Origin: ORIGIN },
    data: {
      username,
      password: PASSWORD,
      firstName: 'Синхронизация',
      language: 'ru',
      deviceName: existing ? 'Second device' : 'First device',
    },
  });
  expect(response.status()).toBe(existing ? 200 : 201);
  const { user } = await response.json();
  await context.addInitScript((user) => {
    if (!localStorage.getItem('craneapp_user_data'))
      localStorage.setItem('craneapp_user_data', JSON.stringify(user));
    const probe = { events: [] as unknown[], reads: 0 };
    Object.assign(window, { settingsProbe: probe });
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event) => {
          try {
            const data = JSON.parse(String(event.data));
            if (data.type === 'settings_updated') probe.events.push(data.payload);
          } catch {
            /* Ignore non-JSON transport frames. */
          }
        });
      }
    };
  }, user);
  return { username, id: user.id as string };
}
async function open(context: BrowserContext, peerTransport?: 'channel' | 'storage') {
  const page = await context.newPage();
  if (peerTransport) {
    // Keep the client socket open, but connect it to no server. Only peer
    // invalidations can update this tab; recovery polling is 30 seconds.
    await page.routeWebSocket('**/ws', (socket) => socket.onMessage(() => {}));
    if (peerTransport === 'storage')
      await page.addInitScript(() => Object.assign(window, { BroadcastChannel: undefined }));
    else
      await page.addInitScript(() =>
        window.addEventListener(
          'storage',
          (event) => {
            if (event.key === 'craneapp:settings-invalidation:v1') event.stopImmediatePropagation();
          },
          true
        )
      );
  }
  await page.goto('/settings/appearance');
  const cloud = page.getByRole('textbox', { name: 'Облачный пароль', exact: true });
  const theme = page.getByRole('radio', { name: 'Системная', exact: true });
  await expect(cloud.or(theme)).toBeVisible();
  if (await cloud.isVisible()) {
    await cloud.fill(CLOUD);
    const repeat = page.getByRole('textbox', { name: 'Повторите облачный пароль', exact: true });
    if (await repeat.isVisible()) await repeat.fill(CLOUD);
    await page.getByRole('button', { name: /^(Сохранить|Открыть историю|Открыть)$/ }).click();
    const later = page.getByRole('button', { name: 'Позже', exact: true });
    await expect(later.or(theme)).toBeVisible();
    if (await later.isVisible()) await later.click();
  }
  await expect(theme).toBeVisible();
  return page;
}
async function choose(page: Page, name: string, role: 'radio' | 'switch' = 'radio') {
  const control = page.getByRole(role, { name, exact: true });
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/users/settings') && r.request().method() === 'PUT'
  );
  if (role === 'switch') await page.getByText(name, { exact: true }).click();
  else await control.click();
  expect((await response).ok()).toBe(true);
  await expect(control).toBeEnabled();
}
const probe = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { settingsProbe: { events: unknown[] } }).settingsProbe
  );
async function checked(page: Page, name: string, value = true) {
  const control = page.getByRole('radio', { name, exact: true });
  if (value) await expect(control).toBeChecked();
  else await expect(control).not.toBeChecked();
}

test('commit → owner sockets → two tabs + another device; failure, offline, projection and isolation', async ({
  browser,
}) => {
  const first = await browser.newContext({ baseURL: ORIGIN, colorScheme: 'dark' });
  const second = await browser.newContext({ baseURL: ORIGIN, colorScheme: 'light' });
  const foreign = await browser.newContext({ baseURL: ORIGIN });
  try {
    const owner = await identity(first);
    const a = await open(first);
    await identity(second, owner.username);
    const device = await open(second);
    const tab = await open(first);
    await identity(foreign);
    const outsider = await open(foreign);
    const errors: string[] = [];
    for (const page of [a, tab, device, outsider])
      page.on('pageerror', (error) => errors.push(error.message));
    // Wait for real sockets, not an artificial eventBus injection.
    for (const context of [first, second, foreign]) {
      const result = await context.request.put('/api/v2/users/settings', {
        headers: { Origin: ORIGIN },
        data: { palette: 'warm' },
      });
      expect(result.ok()).toBe(true);
    }
    await expect.poll(async () => (await probe(device)).events.length).toBeGreaterThan(0);
    await expect.poll(async () => (await probe(outsider)).events.length).toBeGreaterThan(0);
    const foreignEvents = (await probe(outsider)).events.length;
    await choose(a, 'Системная');
    for (const page of [tab, device]) await checked(page, 'Системная');
    await expect(a.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(device.locator('html')).toHaveAttribute('data-theme', 'light');
    await choose(a, 'Полночь');
    await choose(a, 'Бирюзовый');
    await choose(a, 'Крупный');
    await choose(a, 'Компактный');
    await choose(a, 'Время сообщений', 'switch');
    for (const page of [tab, device]) {
      await expect(page.locator('html')).toHaveAttribute('data-palette', 'midnight');
      await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
      await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
      await expect(page.locator('html')).toHaveAttribute('data-chat-density', 'compact');
      await expect(
        page.getByRole('switch', { name: 'Время сообщений', exact: true })
      ).not.toBeChecked();
      expect(
        await page
          .locator('html')
          .evaluate((el) => getComputedStyle(el).getPropertyValue('--ui-text-scale').trim())
      ).toBe('1.15');
    }
    const event = (await probe(device)).events.at(-1);
    expect(event).toEqual({ userId: owner.id, version: 1 });
    expect((await probe(outsider)).events).toHaveLength(foreignEvents);
    await expect(outsider.locator('html')).not.toHaveAttribute('data-palette', 'midnight');
    // A failed real PUT cannot announce a change or persist its optimistic projection.
    const before = (await probe(device)).events.length;
    await a.route('**/api/v2/users/settings', async (route) => {
      if (route.request().method() === 'PUT')
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      else await route.continue();
    });
    await a.getByRole('radio', { name: 'Светлая', exact: true }).click();
    await checked(a, 'Системная');
    await expect(a.getByText('Не удалось сохранить настройки', { exact: true })).toBeVisible();
    expect((await probe(device)).events).toHaveLength(before);
    await a.unroute('**/api/v2/users/settings');
    // Offline context misses the event. Reconnect must read current state without reload.
    await second.setOffline(true);
    await choose(a, 'Светлая');
    await second.setOffline(false);
    await checked(device, 'Светлая');
    // Browser permission and voice volume remain device-local.
    await a.goto('/settings/notifications');
    await device.goto('/settings/notifications');
    const volume = device.getByRole('slider', { name: 'Громкость голосовых', exact: true });
    await volume.fill('0.35');
    await choose(a, 'Уведомления', 'switch');
    await expect(
      device.getByRole('switch', { name: 'Уведомления', exact: true })
    ).not.toBeChecked();
    await expect(volume).toHaveValue('0.35');
    await expect(a.getByRole('slider', { name: 'Громкость голосовых', exact: true })).toHaveValue(
      '1'
    );
    // Language changes apply outside its own settings screen too.
    await a.goto('/settings/language');
    await choose(a, 'English');
    await expect(device.locator('html')).toHaveAttribute('lang', 'en');
    await expect(tab.locator('html')).toHaveAttribute('lang', 'en');
    await device.screenshot({ path: 'test-results/settings-sync-device.png' });
    // Observe the actual early script with the application bundle blocked.
    await device.route('**/src/app/main.tsx', (route) => route.abort());
    await device.reload();
    await expect(device.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(device.locator('html')).toHaveAttribute('data-palette', 'midnight');
    await expect(device.locator('html')).toHaveAttribute('data-text-size', 'large');
    expect(errors).toEqual([]);
  } finally {
    await first.close();
    await second.close();
    await foreign.close();
  }
});

test('peer transports work without server events; account switch clears the previous projection', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: ORIGIN });
  try {
    await identity(context);
    const owner = await open(context);
    const channel = await open(context, 'channel');
    const storage = await open(context, 'storage');
    await choose(owner, 'Полночь');
    await choose(owner, 'Бирюзовый');
    for (const page of [channel, storage]) {
      await expect(page.locator('html')).toHaveAttribute('data-palette', 'midnight', {
        timeout: 5000,
      });
      await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal', { timeout: 5000 });
      expect((await probe(page)).events).toEqual([]);
    }
    const registered = await context.request.post('/api/v2/auth/register', {
      headers: { Origin: ORIGIN },
      data: {
        username: `switched_${Date.now().toString(36)}`,
        password: PASSWORD,
        firstName: 'Другой аккаунт',
        language: 'ru',
      },
    });
    expect(registered.status()).toBe(201);
    const { user } = await registered.json();
    await owner.evaluate(async (user) => {
      // @ts-expect-error production store served by Vite
      const { useProfileStore } = await import('/src/entities/user/model/profileStore.ts');
      useProfileStore.getState().setUser(user);
    }, user);
    for (const page of [owner, channel, storage]) {
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(localStorage.getItem('craneapp_settings') ?? '{}').ownerId)
        )
        .toBe(user.id);
      await expect(page.locator('html')).not.toHaveAttribute('data-palette', 'midnight');
      await expect(page.locator('html')).not.toHaveAttribute('data-accent', 'teal');
    }
  } finally {
    await context.close();
  }
});
