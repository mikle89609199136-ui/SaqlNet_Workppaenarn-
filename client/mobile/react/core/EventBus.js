class EventBus {
  constructor() {
    this.events = new Map();
  }

  on(event, callback) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }

    this.events.get(event).add(callback);
    return () => this.off(event, callback);
  }

  once(event, callback) {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      callback(payload);
    });

    return unsubscribe;
  }

  off(event, callback) {
    this.events.get(event)?.delete(callback);

    if (this.events.get(event)?.size === 0) {
      this.events.delete(event);
    }
  }

  emit(event, payload) {
    this.events.get(event)?.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.error(`Event handler failed for "${event}":`, error);
      }
    });
  }

  clear() {
    this.events.clear();
  }
}

export const eventBus = new EventBus();
export default EventBus;
