import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, request, type FullConfig } from '@playwright/test';
import { ACCOUNT_A, ACCOUNT_B } from './fixtures/accounts';
import {
  applySession,
  loginViaApi,
  stateFilePath,
  type IPreparedState,
  type ISignedInAccount,
} from './fixtures/session';

/**
 * Подготовка прогона.
 *
 * Здесь происходит всё, что стоит делать один раз: два входа и личный
 * чат между участниками. Вход на каждый сценарий упёрся бы в
 * ограничение частоты запросов к `/auth/*`, а создание чата в каждом
 * тесте засоряло бы стенд.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:3000';

  const [healthContext, accountAContext, accountBContext] = await Promise.all([
    request.newContext({ baseURL }),
    request.newContext({ baseURL }),
    request.newContext({ baseURL }),
  ]);

  try {
    // Проверка доступности отдельным шагом: без неё первый же сценарий
    // упал бы на таймауте ожидания элемента, и причину пришлось бы
    // искать в записи экрана вместо сообщения об ошибке.
    const health = await healthContext.get('/health/live');
    if (!health.ok()) {
      throw new Error(
        `Стенд не отвечает (${baseURL}/health/live → ${health.status()}). ` +
          'Проверьте DEV_API_PROXY_TARGET в frontend/.env.'
      );
    }

    const [A, B] = await Promise.all([
      loginViaApi(accountAContext, ACCOUNT_A),
      loginViaApi(accountBContext, ACCOUNT_B),
    ]);

    // Сервер возвращает существующий чат, если он уже заведён, поэтому
    // повторные прогоны новых чатов не плодят.
    const chatResponse = await accountAContext.post('/api/v2/chats/private', {
      data: { userId: B.user.id },
      headers: { Origin: baseURL },
    });

    if (!chatResponse.ok()) {
      throw new Error(
        `Не удалось получить личный чат: ${chatResponse.status()} ${await chatResponse.text()}`
      );
    }

    const { chatId } = (await chatResponse.json()) as { chatId?: string };

    if (!chatId) {
      throw new Error('Ответ на создание личного чата не содержит идентификатора.');
    }

    const state: IPreparedState = { A, B, directChatId: chatId };

    const file = stateFilePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');

    await warmUpDevServer(baseURL, A, chatId);
  } finally {
    await Promise.all([
      healthContext.dispose(),
      accountAContext.dispose(),
      accountBContext.dispose(),
    ]);
  }
}

/**
 * Прогрев dev-сервера.
 *
 * Vite компилирует модули по требованию, а страницы приложения
 * подгружаются лениво — граф каждого экрана собирается при первом заходе
 * именно на него. Без прогрева этот счёт достаётся первому сценарию, и
 * он падает по таймауту на холодном запуске: выглядит как нестабильность,
 * хотя дело только в сборке модулей.
 *
 * Поэтому прогревается ровно тот экран, с которым работают сценарии, — и
 * с настоящей сессией, иначе загрузчик увёл бы на страницу входа, и
 * модули чата так и остались бы нескомпилированными.
 */
async function warmUpDevServer(
  baseURL: string,
  account: ISignedInAccount,
  chatId: string
): Promise<void> {
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({ baseURL });
    await applySession(context, account);

    const page = await context.newPage();
    await page.goto(`/chats/${chatId}`, { waitUntil: 'networkidle', timeout: 180_000 });
  } finally {
    await browser.close();
  }
}
