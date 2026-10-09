import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, Browser, BrowserContext, Cookie, Page } from '@playwright/test';
import type { IAccount } from './accounts';

/**
 * Установка сессии в браузер.
 *
 * `storageState` Playwright сохраняет cookies и localStorage, но не
 * IndexedDB — а ключи шифрования лежат именно там. Восстановленная из
 * `storageState` сессия выглядит рабочей ровно до первой расшифровки.
 *
 * Поэтому здесь только cookie сессии и профиль: они ставятся до загрузки
 * страницы, а ключи приложение создаёт само — теми же путями, что у
 * настоящего пользователя.
 */

const USER_KEY = 'craneapp_user_data';

export interface IUser {
  id: string;
  username: string;
  [key: string]: unknown;
}

export interface ISignedInAccount {
  sessionCookie: Cookie;
  user: IUser;
}

export interface IPreparedState {
  A: ISignedInAccount;
  B: ISignedInAccount;
  /** Личный чат между A и B — он нужен почти каждому сценарию. */
  directChatId: string;
}

const STATE_FILE = path.join(process.cwd(), 'e2e', '.auth', 'state.json');

export function stateFilePath(): string {
  return STATE_FILE;
}

export function readPreparedState(): IPreparedState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as IPreparedState;
  } catch (error) {
    throw new Error(
      `Не удалось прочитать состояние прогона (${STATE_FILE}). ` +
        'Его готовит global-setup: запускайте тесты через `npm run e2e`, а не напрямую. ' +
        `Исходная ошибка: ${(error as Error).message}`
    );
  }
}

/**
 * Логин запросом к API.
 *
 * Через UI логиниться нельзя: на `/auth/*` стоит ограничение в пять
 * запросов в секунду, а форма входа вдобавок ходит за внешним адресом
 * пользователя. Логин делается один раз на прогон.
 */
export async function loginViaApi(
  request: APIRequestContext,
  account: IAccount
): Promise<ISignedInAccount> {
  const response = await request.post('/api/v2/auth/login', {
    data: { username: account.username, password: account.password },
  });

  if (!response.ok()) {
    throw new Error(
      `Вход ${account.username} отклонён: ${response.status()} ${await response.text()}`
    );
  }

  const body = (await response.json()) as { user?: IUser; twoFARequired?: boolean };
  const sessionCookie = (await request.storageState()).cookies.find(({ name }) =>
    name.endsWith('craneapp_session')
  );

  // При включённой двухфакторной сервер отвечает 200, но без пользователя и
  // cookie: проверять только код ответа недостаточно.
  if (!sessionCookie || !body.user) {
    throw new Error(
      body.twoFARequired
        ? `У ${account.username} включена двухфакторная аутентификация — такая учётная запись для прогона не годится.`
        : `Ответ на вход ${account.username} не содержит cookie сессии: ${JSON.stringify(body)}`
    );
  }

  return { sessionCookie, user: body.user };
}

/**
 * Контекст с уже установленной сессией.
 *
 * Каждому пользователю — свой контекст. Ключи шифрования привязаны к
 * origin, поэтому два пользователя в одном контексте пользовались бы
 * одной парой ключей, и проверка шифрования ничего бы не проверяла.
 */
export async function openContextFor(
  browser: Browser,
  account: ISignedInAccount
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await applySession(context, account);

  return context;
}

/**
 * Положить сессию в контекст.
 *
 * Именно addInitScript: приложение читает localStorage на верхнем уровне
 * модуля, до первого рендера. Запись после goto опоздала бы — стор уже
 * создан без профиля и посчитал бы сессию отсутствующей. Cookie добавляется
 * отдельно до первого запроса.
 */
export async function applySession(
  context: BrowserContext,
  account: ISignedInAccount
): Promise<void> {
  await context.addCookies([account.sessionCookie]);
  await context.addInitScript(
    ([userKey, user]) => {
      localStorage.setItem(userKey as string, user as string);
    },
    [USER_KEY, JSON.stringify(account.user)] as const
  );
}

/**
 * Открыть приложение и дождаться готовности шифрования.
 *
 * Признак готовности — публикация открытого ключа: она происходит после
 * того, как пара создана или загружена из хранилища, и ровно перед тем,
 * как сервис объявляет себя готовым. Другого сигнала приложение наружу
 * не даёт.
 */
export async function openApp(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();

  // Ответ ловится любой, а не только успешный: на /auth/* стоит
  // ограничение частоты, и отклонённая публикация выглядела бы как
  // «ключи не готовы» — то есть как таймаут без объяснения причины.
  const published = waitForKeyPublication(page);

  await page.goto(url);

  const status = await published;

  if (status !== 200) {
    // Приложение публикует ключ заново при каждой полной загрузке,
    // поэтому одна повторная попытка снимает отказ по частоте.
    const retried = waitForKeyPublication(page);
    await page.reload();

    const retryStatus = await retried;

    if (retryStatus !== 200) {
      throw new Error(
        `Публикация открытого ключа отклонена (${retryStatus}). ` +
          'Без неё собеседник не сможет прочитать сообщения.'
      );
    }
  }

  // Ключи готовы раньше, чем экран: загрузчики маршрута ходят за чатом и
  // историей, а вся лента расшифровывается по одному сообщению. Пока это
  // идёт, на странице висит заглушка загрузки, и любой поиск элемента
  // упал бы не потому, что элемента нет, а потому, что его ещё не рисуют.
  await page
    .locator('.route-loading-fallback')
    .waitFor({ state: 'detached', timeout: 90_000 })
    .catch(() => {
      // Заглушки может не быть вовсе, если данные уже в кеше.
    });

  return page;
}

function waitForKeyPublication(page: Page): Promise<number> {
  return page
    .waitForResponse(
      (response) =>
        response.url().includes('/api/v2/auth/public-key') &&
        response.request().method() === 'POST',
      { timeout: 60_000 }
    )
    .then((response) => response.status());
}

/**
 * Текст сообщения в ленте.
 *
 * Стенд общий: в чате копятся сообщения прошлых прогонов и живых людей,
 * поэтому «последний пузырь» ничего не значит — ищем свою метку.
 */
export function messageWithText(page: Page, text: string) {
  return page.locator('section.thread-messages .message-content', { hasText: text });
}
