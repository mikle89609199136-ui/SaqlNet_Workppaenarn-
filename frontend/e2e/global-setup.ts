import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { request, type FullConfig } from '@playwright/test';
import { ACCOUNT_A, ACCOUNT_B, uniqueMarker } from './fixtures/accounts';
import { loginViaApi, stateFilePath, type ISignedInAccount } from './fixtures/session';

/** Только тестовые аккаунты: по явному флагу — новая пара на каждый прогон. */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = String(config.projects[0]?.use?.baseURL || 'http://127.0.0.1:3000');
  const contexts = await Promise.all([
    request.newContext({ baseURL }),
    request.newContext({ baseURL }),
  ]);
  try {
    const health = await contexts[0].get('/health/live');
    if (!health.ok()) throw new Error(`Стенд недоступен: /health/live → ${health.status()}`);
    const accounts: ISignedInAccount[] = [];
    for (const [index, account] of [ACCOUNT_A, ACCOUNT_B].entries()) {
      if (process.env.E2E_CREATE_ACCOUNTS === '1') {
        const username = uniqueMarker(`e2e_${account.role.toLowerCase()}`).replaceAll('-', '_');
        const response = await contexts[index].post('/api/v2/auth/register', {
          headers: { Origin: baseURL },
          data: {
            username,
            password: account.password,
            firstName: `E2E ${account.role}`,
            language: 'ru',
          },
        });
        if (response.status() !== 201)
          throw new Error(
            `Регистрация ${account.role}: ${response.status()} ${await response.text()}`
          );
        const { user } = await response.json();
        const sessionCookie = (await contexts[index].storageState()).cookies.find((c) =>
          c.name.endsWith('craneapp_session')
        );
        if (!user?.id || !sessionCookie)
          throw new Error('Регистрация не вернула пользователя и cookie');
        accounts.push({ user, sessionCookie });
      } else accounts.push(await loginViaApi(contexts[index], account));
    }
    const [A, B] = accounts;
    if (A.user.id === B.user.id) throw new Error('E2E требует двух разных пользователей');
    const response = await contexts[0].post('/api/v2/chats/private', {
      headers: { Origin: baseURL },
      data: { userId: B.user.id },
    });
    if (!response.ok())
      throw new Error(`Личный чат: ${response.status()} ${await response.text()}`);
    const { chatId } = await response.json();
    if (!chatId) throw new Error('Не получен chatId');
    mkdirSync(path.dirname(stateFilePath()), { recursive: true });
    writeFileSync(stateFilePath(), JSON.stringify({ A, B, directChatId: chatId }), { mode: 0o600 });
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()));
  }
}
