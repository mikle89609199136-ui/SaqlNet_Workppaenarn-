import { appIsForeground } from './delivery';

/** Background вкладка уступает активной вкладке того же аккаунта, независимо от порядка WS delivery. */
export function createAlertPresence(ownerId: string, sameOwner: () => boolean) {
  let channel: BroadcastChannel | null = null;
  const pending = new Map<string, (foreground: boolean) => void>();
  try {
    if (typeof BroadcastChannel !== 'undefined')
      channel = new BroadcastChannel('craneapp_alert_presence_v1');
  } catch {
    /* Без BroadcastChannel остаётся дедупликация Web Locks/storage. */
  }
  const receive = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.ownerId !== ownerId || typeof data.nonce !== 'string' || !sameOwner()) return;
    if (data.type === 'probe' && appIsForeground())
      channel?.postMessage({ type: 'foreground', ownerId, nonce: data.nonce });
    else if (data.type === 'foreground') pending.get(data.nonce)?.(true);
  };
  channel?.addEventListener('message', receive);
  return {
    hasForegroundPeer: () =>
      new Promise<boolean>((resolve) => {
        if (!channel) {
          resolve(false);
          return;
        }
        const nonce = crypto.randomUUID();
        const finish = (foreground: boolean) => {
          clearTimeout(timer);
          pending.delete(nonce);
          resolve(foreground);
        };
        const timer = setTimeout(() => finish(false), 75);
        pending.set(nonce, finish);
        try {
          channel.postMessage({ type: 'probe', ownerId, nonce });
        } catch {
          finish(false);
        }
      }),
    dispose: () => {
      for (const finish of [...pending.values()]) finish(false);
      channel?.removeEventListener('message', receive);
      channel?.close();
      channel = null;
    },
  };
}
