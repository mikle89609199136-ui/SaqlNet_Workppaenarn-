import { test, expect, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

async function choose(page: Page, role: 'radio' | 'switch', name: string) {
  const control = page.getByRole(role, { name, exact: true });
  await expect(control).toBeEnabled();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/users/settings') && response.request().method() === 'PUT'
  );
  if (role === 'switch') await page.getByText(name, { exact: true }).click();
  else await control.click();
  expect((await saved).ok()).toBeTruthy();
  await expect(control).toBeEnabled();
}

test('реальное API: сохранение, reload, system и ранняя проекция', async ({ page, context }) => {
  const response = await context.request.post('/api/v2/auth/register', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: {
      username: `appearance_${Date.now().toString(36)}`,
      password: 'Local-728-test-password!',
      firstName: 'Оформление',
      language: 'ru',
    },
  });
  expect(response.status()).toBe(201);
  const { user } = await response.json();
  await context.addInitScript(
    (user) => localStorage.setItem('craneapp_user_data', JSON.stringify(user)),
    user
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/settings/appearance');
  await page
    .getByRole('textbox', { name: 'Облачный пароль', exact: true })
    .fill('Local-728-cloud-password!');
  await page
    .getByRole('textbox', { name: 'Повторите облачный пароль', exact: true })
    .fill('Local-728-cloud-password!');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const later = page.getByRole('button', { name: 'Позже', exact: true });
  await expect(later.or(page.getByRole('radio', { name: 'Системная', exact: true }))).toBeVisible();
  if (await later.isVisible()) await later.click();
  await choose(page, 'radio', 'Системная');
  await choose(page, 'radio', 'Полночь');
  await choose(page, 'radio', 'Бирюзовый');
  await choose(page, 'radio', 'Крупный');
  await choose(page, 'radio', 'Компактный');
  await choose(page, 'switch', 'Время сообщений');
  await choose(page, 'switch', 'Статусы доставки и прочтения');
  await choose(page, 'switch', 'Аватарки в ленте группы');
  await choose(page, 'switch', 'Группировать сообщения одного автора');
  const settings = (await (await context.request.get('/api/v2/users/settings')).json()).settings;
  expect(settings).toMatchObject({
    theme: 'system',
    palette: 'midnight',
    accentPreset: 'teal',
    textSize: 'large',
    chatDensity: 'compact',
    showMessageTime: false,
    showMessageStatus: false,
    showMessageAvatars: false,
    groupConsecutiveMessages: false,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect((await (await context.request.get('/api/v2/users/settings')).json()).settings.theme).toBe(
    'system'
  );
  // До API и React: проверяем исполняемый startup-script, блокируя bundle.
  await page.route('**/src/app/main.tsx', (route) => route.abort());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'midnight');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
  await page.unroute('**/src/app/main.tsx');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Системная', exact: true })).toBeChecked();
  await expect(
    page.getByRole('switch', { name: 'Время сообщений', exact: true })
  ).not.toBeChecked();
  // Настоящая лента и composer: собственный зашифрованный чат «Избранное».
  const savedChat = await context.request.post('/api/v2/chats/private', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { userId: user.id },
  });
  expect(savedChat.ok()).toBeTruthy();
  const { chatId } = await savedChat.json();
  await page.goto(`/chats/${chatId}`);
  const composer = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await expect(composer).toBeEditable();
  expect(await composer.evaluate((element) => getComputedStyle(element).fontSize)).toBe('17.25px');
  await composer.fill('Оформление: первая строка');
  await composer.press('Enter');
  await expect(page.getByRole('article')).toHaveCount(1);
  await composer.fill('Оформление: вторая строка');
  await composer.press('Enter');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.locator('article[data-first-in-group=true]')).toHaveCount(2);
  await expect(page.locator('.thread-messages time')).toHaveCount(0);
  await expect(page.locator('.thread-messages [data-delivery]')).toHaveCount(0);
  expect(
    await page
      .locator('.message-bubble')
      .first()
      .evaluate((element) => getComputedStyle(element).paddingTop)
  ).toBe('5px');
  await page.goto('/settings/appearance');
  await expect(page.getByRole('radio', { name: 'Системная', exact: true })).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('radio', { name: 'Системная', exact: true }).scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot('settings-mobile.png');
  await page
    .getByRole('switch', { name: 'Группировать сообщения одного автора', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot('settings-mobile-messages.png', {
    mask: [
      page
        .getByRole('radiogroup', { name: 'Аватарка без фотографии' })
        .locator('[aria-hidden=true]'),
    ],
  });
});

for (const scenario of [
  {
    name: 'normal-dark',
    theme: 'dark',
    textSize: 'medium',
    chatDensity: 'normal',
    palette: 'graphite',
    accentPreset: 'violet',
    width: 1280,
    hidden: false,
  },
  {
    name: 'compact-dark',
    theme: 'dark',
    textSize: 'small',
    chatDensity: 'compact',
    palette: 'midnight',
    accentPreset: 'teal',
    width: 1280,
    hidden: false,
  },
  {
    name: 'large-light-mobile',
    theme: 'light',
    textSize: 'large',
    chatDensity: 'large',
    palette: 'warm',
    accentPreset: 'amber',
    width: 390,
    hidden: false,
  },
  {
    name: 'hidden-mobile',
    theme: 'dark',
    textSize: 'large',
    chatDensity: 'normal',
    palette: 'midnight',
    accentPreset: 'orchid',
    width: 390,
    hidden: true,
  },
]) {
  test(`рендер и visual regression: ${scenario.name}`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 844 });
    const params = new URLSearchParams(
      Object.entries(scenario).map(([key, value]) => [key, String(value)])
    );
    await page.goto(`/tests/appearance/preview.html?${params}`);
    await expect(page.getByRole('article')).toHaveCount(4);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.theme);
    await expect(page.getByText('Не отправлено', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить отправку' })).toBeVisible();
    const metrics = await page
      .locator('.message-bubble')
      .first()
      .evaluate((bubble) => ({
        fontSize: getComputedStyle(bubble).fontSize,
        padding: getComputedStyle(bubble).paddingTop,
      }));
    expect(parseFloat(metrics.fontSize)).toBeCloseTo(
      { small: 13.5, medium: 15, large: 17.25 }[scenario.textSize]!,
      1
    );
    expect(metrics.padding).toBe(
      { compact: '5px', normal: '8px', large: '12px' }[scenario.chatDensity]
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (scenario.hidden) {
      await expect(page.locator('time')).toHaveCount(0);
      await expect(page.locator('[data-delivery]')).toHaveCount(0);
      await expect(page.locator('article[data-first-in-group=true]')).toHaveCount(4);
    }
    await expect(page).toHaveScreenshot(`${scenario.name}.png`);
  });
}
