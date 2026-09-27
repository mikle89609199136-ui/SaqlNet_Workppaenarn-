/**
 * Одновременно звучит одна запись (#843): запуск голосового ставит на паузу
 * то, что играло до него, — как в мессенджерах. Две речи разом никто не
 * разберёт.
 */
let current: HTMLMediaElement | null = null;

export function claimPlayback(media: HTMLMediaElement): void {
  if (current && current !== media && !current.paused) current.pause();
  current = media;
}

/** Остановить то, что играет, — перед записью голосового: микрофон не должен слышать динамик. */
export function pauseActivePlayback(): void {
  if (current && !current.paused) current.pause();
}
