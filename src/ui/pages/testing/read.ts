// Test double for store/read.ts: page tests set `fake` and the read helpers answer from it. Watchers
// register callbacks that `fire()` calls, like a storage change would.
import type { ActivityEvent, Exception, Rule, Settings } from '~/core/types';
import type { ActivityQuery, DayCounters, RuleStats, StoredSubscriptions } from '~/store/local';
import type { EscalationSuggestion } from '~/store/read';
import { DEFAULT_SETTINGS } from '~/store/schema';

export const fake: {
  settings: Settings;
  rules: Rule[];
  exceptions: Exception[];
  activity: ActivityEvent[];
  counters: DayCounters;
  ruleStats: RuleStats;
  subscriptions: StoredSubscriptions | undefined;
  escalations: EscalationSuggestion[];
  fail: boolean;
  queries: ActivityQuery[];
} = initial();

function initial() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    rules: [] as Rule[],
    exceptions: [] as Exception[],
    activity: [] as ActivityEvent[],
    counters: { judged: 0, removed: 0, requests: 0, costUsd: 0 },
    ruleStats: {} as RuleStats,
    subscriptions: undefined as StoredSubscriptions | undefined,
    escalations: [] as EscalationSuggestion[],
    fail: false,
    queries: [] as ActivityQuery[],
  };
}

export function reset(): void {
  Object.assign(fake, initial());
  listeners.clear();
}

const listeners = new Set<() => void>();
export function fire(): void {
  for (const l of [...listeners]) l();
}

const answer = <T>(v: () => T): Promise<T> => (fake.fail ? Promise.reject(new Error('read failed')) : Promise.resolve(v()));
const watch = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const readSettings = () => answer(() => fake.settings);
export const readRules = () => answer(() => fake.rules);
export const readExceptions = () => answer(() => fake.exceptions);
export const readExceptionCount = () => answer(() => fake.exceptions.length);
export const readActivity = (q: ActivityQuery = {}) =>
  answer(() => {
    fake.queries.push(q);
    return fake.activity.filter(
      (e) => (!q.kinds || q.kinds.includes(e.kind)) && (!q.ruleId || e.ruleId === q.ruleId) && (!q.batchId || e.batchId === q.batchId),
    );
  });
export const readCounters = (_day: string) => answer(() => fake.counters);
export const readRuleStats = () => answer(() => fake.ruleStats);
export const readSubscriptions = () => answer(() => fake.subscriptions);
export const readEscalations = () => answer(() => fake.escalations);
export const readEnabled = () => answer(() => fake.settings.enabled);
export const watchSettings = watch;
export const watchRules = watch;
export const watchExceptions = watch;
export const watchActivity = watch;
export const watchCounters = watch;
export const watchRuleStats = watch;
export const watchEscalation = watch;
export const watchRuntime = watch;
export const watchSubscriptions = watch;
