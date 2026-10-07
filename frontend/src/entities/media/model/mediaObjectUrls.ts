/**
 * Реестр расшифрованного медиа.
 *
 * Object URL держит файл в памяти вкладки до тех пор, пока его не отзовут:
 * ни размонтирование компонента, ни вытеснение сообщения из кеша запросов
 * файл не освобождают. Раньше отзыва не было вовсе, а каждый перезапрос
 * ленты — например, от чужой реакции — заново расшифровывал все медиа и
 * заводил на них новые адреса. Прежние оставались в памяти навсегда, и
 * вкладка вырастала до гигабайтов.
 *
 * Теперь у файла один адрес на всё время, пока он нужен, а место
 * освобождается по мере надобности: реестр держит ограниченный объём и
 * отпускает то, к чему дольше всего не обращались.
 */

/**
 * Сколько расшифрованного медиа держать в памяти.
 *
 * Триста мегабайт — заметно больше любой разумной ленты и заметно меньше
 * того, что вкладка может себе позволить. Точное значение не принципиально:
 * важно, что предел вообще есть, иначе реестр стал бы той же утечкой,
 * только упорядоченной.
 */
const MEMORY_BUDGET_BYTES = 300 * 1024 * 1024;

interface IEntry {
  url: string;
  bytes: number;
  /**
   * Сам файл — для «Сохранить как…» (#655): записать его через окно
   * выбора места можно только из Blob, а прочитать blob:-адрес через
   * fetch запрещает CSP. Память это не удваивает: адрес и Blob — одни
   * и те же данные.
   */
  blob: Blob;
}

/**
 * Map хранит порядок вставки, и это здесь работает: обращение к файлу
 * переносит его в конец, поэтому первым на выход всегда идёт тот, к кому
 * дольше всего не обращались.
 */
const entries = new Map<string, IEntry>();

/** Незавершённые расшифровки: два сообщения могут ссылаться на один файл. */
const pending = new Map<string, Promise<string>>();

let heldBytes = 0;

function release(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;

  entries.delete(key);
  heldBytes -= entry.bytes;
  URL.revokeObjectURL(entry.url);
}

function evictUntilFits(): void {
  for (const key of entries.keys()) {
    if (heldBytes <= MEMORY_BUDGET_BYTES) return;
    release(key);
  }
}

/**
 * Адрес расшифрованного файла.
 *
 * `key` — путь к файлу на сервере: он не меняется при перезапросах ленты,
 * и по нему один файл узнаётся в ленте, в закреплённых и в пересылке.
 *
 * Расшифровка выполняется один раз: параллельные обращения к тому же
 * файлу ждут общий результат, а не запускают вторую.
 */
export async function resolveMediaObjectUrl(
  key: string,
  decrypt: () => Promise<Blob>
): Promise<string> {
  const existing = entries.get(key);

  if (existing) {
    // Переносим в конец очереди: файл только что понадобился.
    entries.delete(key);
    entries.set(key, existing);
    return existing.url;
  }

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const request = decrypt()
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      entries.set(key, { url, bytes: blob.size, blob });
      heldBytes += blob.size;
      evictUntilFits();

      return url;
    })
    .finally(() => {
      // Неудачная расшифровка не запоминается: следующая попытка должна
      // сходить на сервер заново.
      pending.delete(key);
    });

  pending.set(key, request);

  return request;
}

/**
 * Отпустить всё.
 *
 * Вызывается при выходе из аккаунта: расшифрованные файлы не должны
 * достаться следующему, кто войдёт в этой вкладке.
 */
export function clearMediaObjectUrls(): void {
  for (const key of [...entries.keys()]) release(key);

  pending.clear();
  heldBytes = 0;
}

/** Расшифрованный файл по его адресу; нет — уже отпущен или адрес чужой. */
export function mediaBlobByUrl(url: string): Blob | undefined {
  for (const entry of entries.values()) {
    if (entry.url === url) return entry.blob;
  }
  return undefined;
}

/** Сколько сейчас удерживается. Для тестов и отладки. */
export function heldMediaBytes(): number {
  return heldBytes;
}
