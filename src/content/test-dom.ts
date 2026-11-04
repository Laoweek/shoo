// DOM helpers for tests of the content engine and every Site. Never imported by production code.
import type { IntersectionFactory } from './watcher';

/** Parse a fixture and return its root element (comments dropped). */
export function parse(html: string, doc: Document = document): Element {
  const t = doc.createElement('template');
  t.innerHTML = html;
  const el = t.content.firstElementChild;
  if (!el) throw new Error('fixture has no element');
  return doc.importNode(el, true);
}

/** Load a composed page fixture into the document body. */
export function loadPage(html: string, path = '/', doc: Document = document): void {
  doc.defaultView?.history.replaceState(null, '', path);
  doc.body.innerHTML = html;
}

/** A controllable IntersectionObserver stand-in (jsdom has none). */
export function fakeIntersection() {
  const observers = new Set<{ cb: Parameters<IntersectionFactory>[0]; els: Set<Element>; init: IntersectionObserverInit }>();
  const factory: IntersectionFactory = (cb, init) => {
    const rec = { cb, els: new Set<Element>(), init };
    observers.add(rec);
    return {
      observe: (el) => void rec.els.add(el),
      unobserve: (el) => void rec.els.delete(el),
      disconnect: () => {
        rec.els.clear();
        observers.delete(rec);
      },
    };
  };
  return {
    factory,
    observed: () => [...observers].flatMap((o) => [...o.els]),
    inits: () => [...observers].map((o) => o.init),
    /** Report the given (default: all observed) elements as intersecting or not. */
    trigger(isIntersecting = true, els?: Element[]) {
      for (const o of [...observers]) {
        const targets = (els ?? [...o.els]).filter((el) => o.els.has(el));
        if (targets.length) o.cb(targets.map((target) => ({ target, isIntersecting })));
      }
    },
  };
}

/** A manual frame scheduler: callbacks run on flush(). */
export function manualScheduler() {
  let queue: Array<() => void> = [];
  return {
    schedule: (cb: () => void) => void queue.push(cb),
    pending: () => queue.length,
    flush() {
      while (queue.length) {
        const q = queue;
        queue = [];
        for (const cb of q) cb();
      }
    },
  };
}

/** Let MutationObserver callbacks (microtasks) run. */
export const microtasks = () => new Promise<void>((r) => queueMicrotask(r)).then(() => new Promise<void>((r) => queueMicrotask(r)));
