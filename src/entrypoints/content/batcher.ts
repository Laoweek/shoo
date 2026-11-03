// judgeTiles batching (docs/spec/architecture.md Section 12): flush at 16 Tiles or 400 ms after the first
// queued Tile, whichever comes first.

export const BATCH_MAX = 16;
export const BATCH_MS = 400;

export interface Batcher<T> {
  add(item: T): void;
  /** Drop queued items without sending (Shoo turned off). */
  clear(): void;
  size(): number;
}

export function createBatcher<T>(flush: (items: T[]) => void, max = BATCH_MAX, delayMs = BATCH_MS): Batcher<T> {
  let items: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    clearTimeout(timer);
    timer = undefined;
    const out = items;
    items = [];
    if (out.length > 0) flush(out);
  };
  return {
    add(item) {
      items.push(item);
      if (items.length >= max) send();
      else timer ??= setTimeout(send, delayMs);
    },
    clear() {
      clearTimeout(timer);
      timer = undefined;
      items = [];
    },
    size: () => items.length,
  };
}
