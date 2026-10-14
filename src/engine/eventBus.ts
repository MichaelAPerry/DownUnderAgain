/** Minimal typed pub/sub used to decouple the sim from audio/UI feedback. */
export class EventBus<Events extends object> {
  private readonly handlers: { [K in keyof Events]?: Array<(e: Events[K]) => void> } = {};

  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof Events>(type: K, e: Events[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (const fn of list.slice()) fn(e);
  }
}
