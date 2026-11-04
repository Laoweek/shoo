// Content script bootstrap (docs/spec/architecture.md Section 12, "Content work at load when Shoo is off").
// One storage.local read of `settings.enabled` and this Site's switch. Off: only the runtimeStateChanged and settingsChanged listeners
// exist, so turning Shoo on later works, and nothing else happens (no observers, no messages). On: ask the
// background for the RuntimeSnapshot and start the pipeline. Content never writes storage and never subscribes
// to storage.onChanged: the background's broadcasts carry every later change.
import type { RuntimeSnapshot } from '~/core/types';
import type { ToContent } from './messaging';
import { createPipeline, worksOn, type Pipeline, type PipelineDeps } from './pipeline';
import { withRetry, type Data, type Reply } from './send';

type Listen = <K extends ToContent>(
  type: K,
  cb: (data: Data<K>) => Reply<K> | Promise<Reply<K>>,
) => () => void;

export interface BootDeps extends PipelineDeps {
  readEnabled(): Promise<boolean>;
  listen: Listen;
}

export interface Booted {
  /** The pipeline once Shoo was on at least once. */
  pipeline(): Pipeline | null;
  dispose(): void;
}

/** Back-off for the first getRuntimeState when the background could not be reached at load. */
export const STATE_RETRY_MS = [1000, 5000, 30_000];

const isSnapshot = (s: unknown): s is RuntimeSnapshot =>
  typeof s === 'object' && s !== null && typeof (s as RuntimeSnapshot).enabled === 'boolean' && typeof (s as RuntimeSnapshot).stages === 'object';

export async function boot(deps: BootDeps): Promise<Booted> {
  // A pipeline is made only once Shoo is on and works on this Site. It stops itself when either ends.
  const onHere = (s: RuntimeSnapshot) => s.enabled && worksOn(s, deps.site.id);
  let pipeline: Pipeline | null = null;
  let disposed = false;
  const offs: Array<() => void> = [];
  const send = withRetry(deps.send);

  function ensure(): Pipeline {
    if (pipeline) return pipeline;
    const p = createPipeline(deps);
    offs.push(
      deps.listen('undoRemoval', (req) => (typeof req?.videoId === 'string' ? p.undoRemoval(req) : { ok: false, reason: 'notFound' })),
      deps.listen('tileVerdicts', (req) => {
        if (typeof req?.batchId === 'string' && Array.isArray(req.results)) p.tileVerdicts(req);
      }),
    );
    return (pipeline = p);
  }

  /** Ask for the RuntimeSnapshot. False when the background could not be reached. */
  async function refresh(): Promise<boolean> {
    const s = await send('getRuntimeState', undefined).catch(() => null);
    if (disposed || !isSnapshot(s)) return disposed;
    if (pipeline || onHere(s)) ensure().apply(s);
    return true;
  }

  // The background could not answer at load: try again after 1 s, 5 s and 30 s, then each time the tab is shown,
  // until it answers or a broadcast started the pipeline. Without this the tab stays inert.
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const onShown = () => {
    if (deps.doc.hidden) return;
    deps.doc.removeEventListener('visibilitychange', onShown);
    void retry(0);
  };
  async function retry(step: number): Promise<void> {
    if (disposed || pipeline || (await refresh())) return;
    const ms = STATE_RETRY_MS[step];
    if (ms === undefined) deps.doc.addEventListener('visibilitychange', onShown);
    else retryTimer = setTimeout(() => void retry(step + 1), ms);
  }
  offs.push(() => {
    clearTimeout(retryTimer);
    deps.doc.removeEventListener('visibilitychange', onShown);
  });

  offs.push(
    deps.listen('runtimeStateChanged', (s) => {
      if (!isSnapshot(s)) return;
      if (pipeline || onHere(s)) ensure().apply(s);
    }),
    // Off at load, a settingsChanged changes nothing here: turning Shoo on is broadcast as runtimeStateChanged.
    deps.listen('settingsChanged', (req) => {
      if (typeof req?.settingsGeneration !== 'number' || typeof req.rulesVersion !== 'string') return;
      pipeline?.settingsChanged(req);
    }),
  );

  if ((await deps.readEnabled()) && !(await refresh())) retryTimer = setTimeout(() => void retry(1), STATE_RETRY_MS[0]);

  return {
    pipeline: () => pipeline,
    dispose() {
      disposed = true;
      for (const off of offs.splice(0)) off();
      pipeline?.dispose();
    },
  };
}
