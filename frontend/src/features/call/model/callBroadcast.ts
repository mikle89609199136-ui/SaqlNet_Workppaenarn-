export type TCallBroadcastEvent =
  { type: 'CALL_DISMISSED'; roomId?: string } | { type: 'CALL_ACCEPTED'; roomId: string };

const CHANNEL_NAME = 'craneapp_calls';

let channelInstance: BroadcastChannel | null = null;

export function getCallBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channelInstance) {
    try {
      channelInstance = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channelInstance = null;
    }
  }
  return channelInstance;
}

export function broadcastCallEvent(event: TCallBroadcastEvent): void {
  try {
    const ch = getCallBroadcastChannel();
    ch?.postMessage(event);
  } catch {
    // Безопасный игнор в окружениях без поддержки BroadcastChannel
  }
}

export function subscribeCallBroadcast(handler: (event: TCallBroadcastEvent) => void): () => void {
  const ch = getCallBroadcastChannel();
  if (!ch) return () => {};

  const onMessage = (e: MessageEvent<TCallBroadcastEvent>) => {
    if (e.data && typeof e.data === 'object' && 'type' in e.data) {
      handler(e.data);
    }
  };

  ch.addEventListener('message', onMessage);
  return () => {
    ch.removeEventListener('message', onMessage);
  };
}

export function resetCallBroadcastForTests(): void {
  if (channelInstance) {
    try {
      channelInstance.close();
    } catch {
      // Игнорируем ошибку закрытия уже уничтоженного канала в тестах
    }
    channelInstance = null;
  }
}
