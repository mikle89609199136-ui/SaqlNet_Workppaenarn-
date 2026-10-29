import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:3000';

async function handshake(page: Page, pageURL: string, cookieName: string, status: number) {
  // Настоящая страница с нужным origin, без запуска остального приложения.
  const document = await page.goto(pageURL);
  expect(document?.status()).toBe(200);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  let responseStatus: number | undefined;
  let headers: Record<string, string> = {};
  cdp.on('Network.webSocketWillSendHandshakeRequest', (event) => {
    headers = event.request.headers;
  });
  cdp.on('Network.webSocketHandshakeResponseReceived', (event) => {
    responseStatus = event.response.status;
  });
  const result = await page.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(url);
        const timer = setTimeout(() => {
          socket.close();
          resolve('timeout');
        }, 10_000);
        socket.onopen = () => {
          clearTimeout(timer);
          socket.close();
          resolve('open');
        };
        socket.onerror = () => {
          clearTimeout(timer);
          resolve('error');
        };
      }),
    'ws://127.0.0.1:3000/ws'
  );
  expect(result).toBe(status === 101 ? 'open' : 'error');
  await expect.poll(() => responseStatus).toBe(status);
  expect(headers.Origin).toBe(new URL(pageURL).origin);
  // Браузер сам посылает HttpOnly cookie, без подмены заголовков.
  expect(headers.Cookie).toContain(`${cookieName}=`);
  await cdp.detach();
}

test('Vite → Edge → Chat сохраняет Origin: allowed 101, forbidden 403 с той же cookie', async ({
  context,
  page,
}) => {
  await expect
    .poll(async () => (await context.request.get('/api/v2/users/me')).status(), { timeout: 15_000 })
    .toBe(401);
  const registration = await context.request.post('/api/v2/auth/register', {
    headers: { Origin: ORIGIN },
    data: {
      username: `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      password: 'Proxy-499-password!',
      firstName: 'Прокси',
    },
  });
  expect(registration.status()).toBe(201);
  const cookie = (await context.cookies(ORIGIN)).find((item) => item.name === 'craneapp_session');
  expect(cookie).toBeDefined();
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  await handshake(page, `${ORIGIN}/@vite/client`, cookie!.name, 101);

  // Отрицательный Upgrade идёт через тот же proxy с ТОЙ ЖЕ действующей cookie.
  // Небраузерный клиент исключает влияние browser SameSite/third-party policy.
  const denied = await new Promise<{ status: number | undefined; body: string }>(
    (resolve, reject) => {
      const req = request(`${ORIGIN}/ws`, {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
          'Sec-WebSocket-Version': '13',
          Origin: 'http://forbidden.invalid',
          Cookie: `${cookie!.name}=${cookie!.value}`,
        },
      });
      req.setTimeout(10_000, () => req.destroy(new Error('Handshake timeout')));
      req.on('error', reject);
      req.on('upgrade', (_response, socket) => {
        socket.destroy();
        reject(new Error('Запрещённый Origin открыл WebSocket'));
      });
      req.on('response', (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, body }));
      });
      req.end();
    }
  );
  expect(denied.status).toBe(403);
  expect(denied.body.trim()).toBe('origin not allowed');
  expect((await context.cookies(ORIGIN)).find((item) => item.name === cookie!.name)).toEqual(
    cookie
  );
  // Отказ другому origin не отзывает сессию: браузер снова подключается.
  await handshake(page, `${ORIGIN}/@vite/client`, cookie!.name, 101);
});
