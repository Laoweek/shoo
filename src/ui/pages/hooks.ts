// Data hooks for extension pages. Pages read storage only through store/read.ts and re-read when a
// watcher fires. Every mutation is a message to the background (architecture.md Section 8, Writers).
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { RuntimeSnapshot } from '~/core/types';
import { sendMessage } from '~/messaging/protocol';
import { watchRules, watchRuntime, watchSettings } from '~/store/read';

export type Watch = (cb: () => void) => () => void;

export interface Async<T> {
  data?: T;
  error?: unknown;
  /** True until the first load settles. Later reloads keep the old data on screen. */
  loading: boolean;
  reload: () => void;
}

/**
 * Loads `load()` on mount, again whenever `deps` change or a watcher fires. Results from an older call
 * that settle late are dropped, so fast typing in a search box never shows stale rows.
 */
export function useAsync<T>(load: () => Promise<T>, watchers: readonly Watch[] = [], deps: readonly unknown[] = []): Async<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(() => {
    const n = ++seq.current;
    loader
      .current()
      .then((data) => n === seq.current && setState({ data, loading: false }))
      .catch((error: unknown) => n === seq.current && setState((s) => ({ data: s.data, error, loading: false })));
  }, []);

  useEffect(() => {
    reload();
    const offs = watchers.map((w) => w(reload));
    return () => offs.forEach((off) => off());
  }, deps);

  return { ...state, reload };
}

/** `value` once it has stopped changing for `ms`, for search boxes whose every change costs a storage read. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** The RuntimeSnapshot from the background, refreshed when settings, Rules or failure counters change. */
export function useRuntime(): Async<RuntimeSnapshot> {
  return useAsync(() => sendMessage('getRuntimeState'), [watchSettings, watchRuntime, watchRules]);
}

/** navigator.onLine, live. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Wall-clock time that ticks once a minute, for "this week" and Undo windows. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
