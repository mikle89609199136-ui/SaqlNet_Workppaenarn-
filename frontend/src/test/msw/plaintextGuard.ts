/**
 * Сторож открытого текста.
 *
 * Главный инвариант приложения — «незашифрованное сообщение не уходит на
 * сервер» — это утверждение о теле HTTP-запроса, а не об аргументе вызова
 * сервиса. Между ними JSON.stringify, заголовки и сборка адреса.
 *
 * Тест регистрирует текст, который считает секретом, и дальше любой запрос
 * с этим текстом в теле валит тест — на любом маршруте, включая те,
 * которых ещё не существует.
 */

interface IViolation {
  method: string;
  url: string;
  marker: string;
}

const markers = new Set<string>();
const violations: IViolation[] = [];

let counter = 0;

/**
 * Возвращает уникальный текст-маркер и берёт его под наблюдение.
 * Строка намеренно длинная и неугадываемая: короткая случайно совпала бы
 * со служебным полем и дала ложное срабатывание.
 */
export function secretText(label = 'секрет'): string {
  counter += 1;
  return watchPlaintext(`${label}-МАРКЕР-${counter}-a7f3c9e1b2d4`);
}

/** Берёт под наблюдение уже существующий текст. */
export function watchPlaintext(text: string): string {
  markers.add(text);
  return text;
}

export function inspectRequestBody(method: string, url: string, body: string): void {
  if (!body) return;

  for (const marker of markers) {
    if (body.includes(marker)) {
      violations.push({ method, url, marker });
    }
  }
}

export function resetPlaintextGuard(): void {
  markers.clear();
  violations.length = 0;
}

/**
 * Вызывается после каждого теста. Проверка вынесена из обработчика запроса
 * намеренно: исключение, брошенное внутри перехватчика, до теста не дойдёт.
 */
export function assertNoPlaintextLeaked(): void {
  if (violations.length === 0) return;

  const details = violations
    .map(({ method, url, marker }) => `  ${method} ${url} — в теле найдено «${marker}»`)
    .join('\n');

  violations.length = 0;

  throw new Error(`Открытый текст ушёл на сервер:\n${details}`);
}
