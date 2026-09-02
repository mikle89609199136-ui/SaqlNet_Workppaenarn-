import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../msw/server';
import { assertNoPlaintextLeaked, resetPlaintextGuard } from '../msw/plaintextGuard';

beforeAll(() => {
  // Забытый маршрут должен падать, а не возвращать undefined: иначе тест
  // проходит, а приложение в этот момент не получило данных.
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  assertNoPlaintextLeaked();
  resetPlaintextGuard();
});

afterAll(() => {
  server.close();
});
