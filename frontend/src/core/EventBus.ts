import type { IWsEventMap } from "@/types";

export type Handler<TPayload = unknown> = (payload: TPayload) => void;

export class EventBus<TEvents extends object> {
  private events = new Map<keyof TEvents, Set<Handler<any>>>();

  on<TKey extends keyof TEvents>(
    event: TKey,
    callback: Handler<TEvents[TKey]>,
  ): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set<Handler<TEvents[TKey]>>());
    }

    const handlers = this.events.get(event);

    if (!handlers) {
      throw new Error(`Failed to initialize event "${String(event)}"`);
    }

    handlers.add(callback);
    return () => this.off(event, callback);
  }

  once<TKey extends keyof TEvents>(
    event: TKey,
    callback: Handler<TEvents[TKey]>,
  ): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      callback(payload);
    });
    return unsubscribe;
  }

  off<TKey extends keyof TEvents>(
    event: TKey,
    callback: Handler<TEvents[TKey]>,
  ): void {
    const handlers = this.events.get(event);

    if (!handlers) {
      return;
    }

    handlers.delete(callback);

    if (handlers.size === 0) {
      this.events.delete(event);
    }
  }

  emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]): void {
    const handlers = this.events.get(event);
    if (!handlers) {
      return;
    }
    handlers.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.error(`Event handler failed for "${String(event)}":`, error);
      }
    });
  }

  clear(): void {
    this.events.clear();
  }
}

export const eventBus = new EventBus<IWsEventMap>();
