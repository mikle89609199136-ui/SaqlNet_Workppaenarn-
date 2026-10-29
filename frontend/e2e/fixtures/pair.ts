import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { openApp, openContextFor, readPreparedState, type IPreparedState } from './session';

interface IPair extends IPreparedState {
  sender: Page;
  receiver: Page;
  senderContext: BrowserContext;
  receiverContext: BrowserContext;
}

// Контексты живут весь прогон: IndexedDB и облачная копия не подменяются.
export const test = base.extend<{}, { pair: IPair }>({
  pair: [
    async ({ browser }, use, workerInfo) => {
      const baseURL = String(workerInfo.project.use.baseURL);
      const state = readPreparedState();
      const receiverContext = await openContextFor(browser, state.B, baseURL);
      const senderContext = await openContextFor(browser, state.A, baseURL);
      try {
        // Два браузера за Vite имеют общий IP. Auth/crypto API разрешает
        // 30 запросов/мин: отправляем настоящие запросы последовательно,
        // не подменяя ответы и не повторяя отклонённые операции приложения.
        let nextCryptoRequest = 0;
        const paceCrypto = async (route: import('@playwright/test').Route) => {
          const now = Date.now();
          const slot = Math.max(now, nextCryptoRequest);
          nextCryptoRequest = slot + 2100;
          await new Promise((resolve) => setTimeout(resolve, slot - now));
          await route.continue();
        };
        await Promise.all(
          [receiverContext, senderContext].map((context) =>
            context.route('**/api/v2/encryption/**', paceCrypto)
          )
        );
        await receiverContext.addInitScript(() => {
          const Native = window.WebSocket;
          const sockets: WebSocket[] = [];
          Object.assign(window, { __e2eSockets: sockets });
          window.WebSocket = class extends Native {
            constructor(url: string | URL, protocols?: string | string[]) {
              super(url, protocols);
              if (new URL(String(url)).pathname === '/ws') sockets.push(this);
            }
          };
        });
        // Сначала обе личности, затем ключ чата: никто не шифрует
        // для ещё не опубликованной или заменённой личности получателя.
        const receiver = await openApp(receiverContext, `${baseURL}/chats`);
        const sender = await openApp(senderContext, `${baseURL}/chats`);
        // Пустой личный чат ещё может отсутствовать в списке получателя.
        for (const page of [receiver, sender]) {
          await page.goto(`${baseURL}/chats/${state.directChatId}`);
          await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeEditable({
            timeout: 60_000,
          });
          await waitForHistory(page);
        }
        await use({ ...state, receiver, sender, receiverContext, senderContext });
      } finally {
        await Promise.all([receiverContext.close(), senderContext.close()]);
      }
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});

export async function waitForHistory(page: Page) {
  await expect(page.locator('.thread-messages')).toHaveAttribute('aria-busy', 'false', {
    timeout: 90_000,
  });
}

export async function send(page: Page, text: string) {
  await waitForHistory(page);
  const composer = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await expect(composer).toBeEditable({ timeout: 60_000 });
  await composer.fill(text);
  const chatId = new URL(page.url()).pathname.split('/').at(-1);
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v2/messages/${chatId}`,
      { timeout: 60_000 }
    ),
    page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click(),
  ]);
  expect(response.ok()).toBe(true);
}

export async function openChat(page: Page, chatId: string) {
  // Пустой чат/группа может ещё отсутствовать в виртуальном списке.
  await page.goto(`/chats/${chatId}`);
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeEditable({
    timeout: 60_000,
  });
  await waitForHistory(page);
}

export { expect };
