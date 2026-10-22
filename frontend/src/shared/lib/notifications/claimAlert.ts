const TTL = 5 * 60_000;
const LIMIT = 512;
const memory = new Map<string, Map<string, number>>();

/** Только id/время, без текста, ключей и содержимого settings. Web Locks сериализуют вкладки. */
export async function claimAlert(
  ownerId: string,
  eventId: string,
  action: () => Promise<void> | void
): Promise<void> {
  const key = `craneapp_alerts_v1:${ownerId}`;
  const claim = async () => {
    const now = Date.now();
    let entries = memory.get(ownerId) ?? new Map<string, number>();
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      entries = new Map<string, number>();
      if (Array.isArray(stored))
        for (const item of stored) {
          if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'number')
            entries.set(item[0], item[1]);
        }
    } catch {
      /* Без storage работает дедупликация текущей вкладки. */
    }
    entries = new Map([...entries].filter(([, at]) => now - at < TTL).slice(-(LIMIT - 1)));
    if (entries.has(eventId)) return false;
    entries.set(eventId, now);
    memory.set(ownerId, entries);
    try {
      localStorage.setItem(key, JSON.stringify([...entries]));
    } catch {
      /* Не блокируем UI. */
    }
    return true;
  };
  const claimed =
    typeof navigator !== 'undefined' && navigator.locks?.request
      ? await navigator.locks.request(key, claim)
      : await claim();
  if (claimed) await action();
}
