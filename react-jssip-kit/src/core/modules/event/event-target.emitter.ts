export type Listener<T = unknown> = (payload: T) => void;

type ListenerBuckets<Events extends Record<string, unknown>> = {
  [K in keyof Events]?: Set<Listener<Events[K]>>;
};
export class JssipEventEmitter<
  Events extends Record<string, unknown> = Record<string, unknown>,
> {
  private listeners: ListenerBuckets<Events> = {};

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const bucket = this.listeners[event] ?? new Set<Listener<Events[K]>>();
    this.listeners[event] = bucket;
    bucket.add(fn);

    return () => {
      const current = this.listeners[event];
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) delete this.listeners[event];
    };
  }

  emit<K extends keyof Events>(event: K, payload?: Events[K]): void {
    const bucket = this.listeners[event];
    if (!bucket || bucket.size === 0) return;

    for (const listener of Array.from(bucket)) {
      try {
        listener(payload as Events[K]);
      } catch (error) {
        console.error("[react-jssip-kit] event listener failed", {
          event: String(event),
          error,
        });
      }
    }
  }
}
