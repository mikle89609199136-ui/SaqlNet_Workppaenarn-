import { expect, test, type BrowserContext, type Page } from '@playwright/test';
const ORIGIN = 'http://127.0.0.1:3000';
const PASSWORD = 'Local-720-password!';
const CLOUD = 'Local-720-cloud!';
type Session = { id: string; deviceName: string; isCurrent: boolean };
async function identity(
  context: BrowserContext,
  name: string,
  existing?: string,
  deviceType: 'desktop' | 'mobile' | 'tablet' = 'desktop'
) {
  const username =
    existing ?? `session_${Math.random().toString(36).slice(2, 7)}_${Date.now().toString(36)}`;
  const response = await context.request.post(`/api/v2/auth/${existing ? 'login' : 'register'}`, {
    headers: { Origin: ORIGIN },
    data: {
      username,
      password: PASSWORD,
      firstName: 'Сеансы',
      language: 'ru',
      deviceName: name,
      deviceType,
    },
  });
  expect(response.status()).toBe(existing ? 200 : 201);
  const { user } = await response.json();
  // Registration has no device-name input; use its canonical metadata endpoint.
  const named = await context.request.post('/api/v2/users/devices/register', {
    headers: { Origin: ORIGIN },
    data: { deviceName: name, deviceType },
  });
  expect(named.ok()).toBe(true);
  await context.addInitScript((user) => {
    if (!localStorage.getItem('craneapp_user_data'))
      localStorage.setItem('craneapp_user_data', JSON.stringify(user));
    const probe = { opened: 0, closed: 0 };
    Object.assign(window, { sessionSocketProbe: probe });
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('open', () => {
          probe.opened++;
        });
        this.addEventListener('close', () => {
          probe.closed++;
        });
      }
    };
  }, user);
  return { username, id: user.id as string };
}
async function open(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('/settings/account/sessions');
  const cloud = page.getByRole('textbox', { name: 'Облачный пароль', exact: true });
  const ready = page.getByRole('region', { name: 'Это устройство', exact: true });
  await expect(cloud.or(ready)).toBeVisible();
  if (await cloud.isVisible()) {
    await cloud.fill(CLOUD);
    const repeat = page.getByRole('textbox', { name: 'Повторите облачный пароль', exact: true });
    if (await repeat.isVisible()) await repeat.fill(CLOUD);
    await page.getByRole('button', { name: /^(Сохранить|Открыть историю|Открыть)$/ }).click();
    const later = page.getByRole('button', { name: 'Позже', exact: true });
    await expect(later.or(ready)).toBeVisible();
    if (await later.isVisible()) await later.click();
  }
  await expect(ready).toBeVisible();
  await expect.poll(async () => (await sockets(page)).opened).toBeGreaterThan(0);
  return page;
}
const sockets = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { sessionSocketProbe: { opened: number; closed: number } })
        .sessionSocketProbe
  );
async function sessions(context: BrowserContext) {
  const response = await context.request.get('/api/v2/auth/sessions');
  expect(response.ok()).toBe(true);
  return (await response.json()).sessions as Session[];
}
async function fingerprint(page: Page, owner: string) {
  return page.evaluate(async (owner) => {
    // @ts-expect-error Vite serves the production service module.
    const { services } = await import('/src/services/serviceContainer.ts');
    return services.cryptoService.fingerprintOf(owner);
  }, owner);
}

test('selective revoke and terminate-others: actual tokens/sockets, current E2E keys and unrelated account', async ({
  browser,
}) => {
  const current = await browser.newContext({ baseURL: ORIGIN });
  const phone = await browser.newContext({ baseURL: ORIGIN });
  const tablet = await browser.newContext({ baseURL: ORIGIN });
  const foreign = await browser.newContext({ baseURL: ORIGIN });
  try {
    const owner = await identity(current, 'Компьютер #720');
    await identity(phone, 'Телефон #720', owner.username, 'mobile');
    await identity(tablet, 'Планшет #720', owner.username, 'tablet');
    await identity(foreign, 'Чужой аккаунт #720');
    const a = await open(current),
      b = await open(phone),
      c = await open(tablet),
      d = await open(foreign);
    const errors: string[] = [];
    for (const page of [a, b, c, d]) page.on('pageerror', (error) => errors.push(error.message));
    const before = await sessions(current);
    expect(before).toHaveLength(3);
    const currentId = before.find((row) => row.isCurrent)!.id;
    const phoneId = (await sessions(phone)).find((row) => row.isCurrent)!.id;
    const tabletId = (await sessions(tablet)).find((row) => row.isCurrent)!.id;
    expect(new Set([currentId, phoneId, tabletId]).size).toBe(3);
    const key = await fingerprint(a, owner.id);
    expect(key).toBeTruthy();
    await a.evaluate(async () => {
      // @ts-expect-error Production draft store; no plaintext leaves this page.
      const { writeDraft } = await import('/src/entities/chat/model/chatDraftsStore.ts');
      writeDraft('session-720-sentinel', 'Сохранить черновик');
    });
    await expect(a.getByRole('region', { name: 'Это устройство', exact: true })).toContainText(
      'Компьютер #720'
    );
    await expect(
      a.getByRole('button', { name: 'Завершить сеанс: Компьютер #720', exact: true })
    ).toHaveCount(0);
    await a.screenshot({ path: 'test-results/sessions-desktop.png' });
    await a.setViewportSize({ width: 390, height: 844 });
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
      true
    );
    await a.screenshot({ path: 'test-results/sessions-mobile.png' });
    const deletes: string[] = [];
    let logoutAll = 0,
      others = 0;
    a.on('request', (request) => {
      if (request.method() === 'DELETE' && request.url().includes('/users/devices/'))
        deletes.push(request.url().split('/').at(-1)!);
      if (request.url().endsWith('/auth/logout-all')) logoutAll++;
      if (request.url().endsWith('/users/devices/terminate-all')) others++;
    });
    const phoneButton = a.getByRole('button', {
      name: 'Завершить сеанс: Телефон #720',
      exact: true,
    });
    await phoneButton.click();
    await expect(a.getByRole('alertdialog')).toContainText('Телефон #720');
    await a.keyboard.press('Escape');
    await expect(a.getByRole('alertdialog')).toHaveCount(0);
    expect(deletes).toEqual([]);
    const phoneClosed = (await sockets(b)).closed,
      tabletClosed = (await sockets(c)).closed;
    await phoneButton.click();
    await a.getByRole('button', { name: 'Завершить сеанс', exact: true }).click();
    await expect(phoneButton).toHaveCount(0);
    expect(deletes).toEqual([phoneId]);
    expect(others).toBe(0);
    expect(logoutAll).toBe(0);
    expect((await phone.request.get('/api/v2/auth/sessions')).status()).toBe(401);
    await expect.poll(async () => (await sockets(b)).closed).toBeGreaterThan(phoneClosed);
    expect((await sessions(current)).map((row) => row.id).sort()).toEqual(
      [currentId, tabletId].sort()
    );
    expect((await sessions(tablet)).find((row) => row.isCurrent)?.id).toBe(tabletId);
    expect((await sessions(foreign)).some((row) => row.isCurrent)).toBe(true);
    expect(await fingerprint(a, owner.id)).toBe(key);
    await expect(b).toHaveURL(/\/login(?:\?|$)/, { timeout: 25_000 });
    await a.getByRole('button', { name: 'Завершить все, кроме этого', exact: true }).click();
    await expect(a.getByRole('alertdialog')).toContainText('Это устройство продолжит работу');
    await a.getByRole('button', { name: 'Завершить остальные', exact: true }).click();
    await expect(a.getByText('Других активных сеансов нет.', { exact: true })).toBeVisible();
    expect(others).toBe(1);
    expect(logoutAll).toBe(0);
    expect((await tablet.request.get('/api/v2/auth/sessions')).status()).toBe(401);
    await expect.poll(async () => (await sockets(c)).closed).toBeGreaterThan(tabletClosed);
    await expect(c).toHaveURL(/\/login(?:\?|$)/, { timeout: 25_000 });
    expect((await sessions(current)).map((row) => row.id)).toEqual([currentId]);
    expect((await sessions(foreign)).some((row) => row.isCurrent)).toBe(true);
    expect(await fingerprint(a, owner.id)).toBe(key);
    const draft = await a.evaluate(async () => {
      // @ts-expect-error Production draft store served by Vite.
      const { readDraft } = await import('/src/entities/chat/model/chatDraftsStore.ts');
      return readDraft('session-720-sentinel');
    });
    expect(draft).toBe('Сохранить черновик');
    await expect(a).toHaveURL(/\/settings\/account\/sessions$/);
    await expect(d).toHaveURL(/\/settings\/account\/sessions$/);
    expect(errors).toEqual([]);
  } finally {
    await current.close();
    await phone.close();
    await tablet.close();
    await foreign.close();
  }
});
