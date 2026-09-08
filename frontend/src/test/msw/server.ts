import { setupServer } from 'msw/node';
import { defaultHandlers } from './handlers';
import { inspectRequestBody } from './plaintextGuard';

export const server = setupServer(...defaultHandlers);

// Каждое исходящее тело проходит через сторож открытого текста.
// Клонирование обязательно: тело — поток, и приложение прочитает его следом.
server.events.on('request:start', async ({ request }) => {
  if (request.method === 'GET' || request.method === 'HEAD') return;

  try {
    const body = await request.clone().text();
    inspectRequestBody(request.method, request.url, body);
  } catch {
    // Тело нечитаемо (например, поток файла) — проверять нечего.
  }
});
