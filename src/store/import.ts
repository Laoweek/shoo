// Hand-written validators for the export file (REQ-RULE-9, docs/spec/architecture.md Section 8, "Export
// and import"). No schema library, so the options and background bundles stay small. Pure: no storage.
import { parseRef, trimName, validateRuleInput } from '~/core/rules';
import { SITE_IDS, videoSite } from '~/core/sites';
import { RULE_KINDS, type Exception, type Rule, type RuleParams, type SiteId } from '~/core/types';
import { isRecord } from './areas';

export const IMPORT_MAX_RULES = 2000;
export const IMPORT_MAX_EXCEPTIONS = 20000;
const ORIGINS = ['user', 'escalation', 'starter'] as const;
const COLOUR_RE = /^c(10|[1-9])$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Canonical refs only (no leading zero) with a bounded number, so text equality is ref equality. */
const REF_IMPORT_RE = /^[RK][1-9]\d{0,5}$/;
/** Timestamps may run ahead of this device's clock by at most a day. */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/** Same shape as `ImportPreview` in messaging/protocol.ts. */
export interface ImportPreview {
  add: number;
  update: number;
  renumber: number;
  invalid: string[];
  /** Replace only: live Rules and Exceptions (archive included) that are not in the file and would be removed. */
  remove?: { rules: number; exceptions: number };
  /** The imported Rule set does not fit the sync budget, so the import would fail with `syncQuota`. */
  syncQuota?: true;
}

export interface ParsedImport {
  rules: Rule[];
  exceptions: Exception[];
  /** One entry per skipped item, e.g. 'rules[3]: regex.nestedQuantifier'. */
  invalid: string[];
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const optString = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max);

function parseParams(v: unknown): RuleParams | undefined | 'invalid' {
  if (v === undefined) return undefined;
  if (!isRecord(v)) return 'invalid';
  const out: RuleParams = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === 'channelName' || k === 'channelId' || k === 'handle') {
      if (typeof val !== 'string' || val.length > 200) return 'invalid';
      out[k] = val;
    } else if (k === 'minSeconds' || k === 'maxSeconds' || k === 'minViews' || k === 'maxViews') {
      if (typeof val !== 'number' || !Number.isFinite(val)) return 'invalid';
      out[k] = val;
    } else return 'invalid';
  }
  return out;
}

/** A Rule from the file, or the reason it is skipped. Regex Rules go through core/regex.ts. */
export function parseImportedRule(v: unknown, now = Date.now()): Rule | string {
  if (!isRecord(v)) return 'notAnObject';
  const { id, ref, polarity, kind, text, name, params, site, colour, skipSubscribed, enabled, origin, createdAt, updatedAt, deletedAt } = v;
  if (typeof id !== 'string' || !ID_RE.test(id)) return 'id';
  if (polarity !== 'remove' && polarity !== 'keep') return 'polarity';
  if (typeof kind !== 'string' || !(RULE_KINDS as readonly string[]).includes(kind)) return 'kind';
  const parsedRef = typeof ref === 'string' && REF_IMPORT_RE.test(ref) ? parseRef(ref) : undefined;
  if (!parsedRef || parsedRef.letter !== (polarity === 'remove' ? 'R' : 'K')) return 'ref';
  if (typeof text !== 'string') return 'text';
  if (name !== undefined && typeof name !== 'string') return 'name';
  const pa = parseParams(params);
  if (pa === 'invalid') return 'params';
  if (site !== undefined && !(SITE_IDS as readonly unknown[]).includes(site)) return 'site';
  if (colour !== undefined && (typeof colour !== 'string' || !COLOUR_RE.test(colour) || polarity === 'keep')) return 'colour';
  if (skipSubscribed !== undefined && typeof skipSubscribed !== 'boolean') return 'skipSubscribed';
  if (typeof enabled !== 'boolean') return 'enabled';
  if (typeof origin !== 'string' || !(ORIGINS as readonly string[]).includes(origin)) return 'origin';
  if (!isTime(createdAt) || !isTime(updatedAt) || Math.max(createdAt, updatedAt) > now + FUTURE_SLACK_MS) return 'timestamps';
  if (deletedAt !== undefined) return 'deleted';
  const rule: Rule = {
    id,
    ref: ref as string,
    polarity,
    kind: kind as Rule['kind'],
    text,
    enabled,
    origin: origin as Rule['origin'],
    createdAt,
    updatedAt,
  };
  if (pa) rule.params = pa;
  if (site !== undefined) rule.site = site as SiteId;
  if (colour !== undefined) rule.colour = colour as Rule['colour'];
  if (skipSubscribed === true) rule.skipSubscribed = true;
  const named = trimName({ ...rule, name });
  const check = validateRuleInput(named);
  return check.ok ? named : check.reason;
}

export function parseImportedException(v: unknown, now = Date.now()): Exception | string {
  if (!isRecord(v)) return 'notAnObject';
  const { videoId, title, channelName, channelKey, ruleId, at } = v;
  // A YouTube or a Bilibili video ID (core/sites.ts).
  if (typeof videoId !== 'string' || videoSite(videoId) === undefined) return 'videoId';
  if (typeof title !== 'string' || title.length > 500) return 'title';
  if (!optString(channelName, 200) || !optString(channelKey, 200) || !optString(ruleId, 64)) return 'channel';
  if (!isTime(at) || at > now + FUTURE_SLACK_MS) return 'at';
  const x: Exception = { videoId, title, at };
  if (channelName !== undefined) x.channelName = channelName as string;
  if (channelKey !== undefined) x.channelKey = channelKey as string;
  if (ruleId !== undefined) x.ruleId = ruleId as string;
  return x;
}

/**
 * Checks the file envelope (a malformed file is rejected whole) and every entry (an invalid entry is
 * skipped and listed). Duplicate Rule ids keep the first, duplicate Exceptions keep the newest.
 */
export function parseImportFile(file: unknown, now = Date.now()): { ok: true; value: ParsedImport } | { ok: false; detail: string } {
  if (!isRecord(file)) return { ok: false, detail: 'notAnObject' };
  if (file.format !== 'shoo-rules') return { ok: false, detail: 'format' };
  if (file.version !== 1) return { ok: false, detail: 'version' };
  if (!Array.isArray(file.rules) || !Array.isArray(file.exceptions)) return { ok: false, detail: 'missingLists' };
  if (file.rules.length > IMPORT_MAX_RULES || file.exceptions.length > IMPORT_MAX_EXCEPTIONS) return { ok: false, detail: 'tooLarge' };

  const invalid: string[] = [];
  const rules = new Map<string, Rule>();
  file.rules.forEach((raw, i) => {
    const r = parseImportedRule(raw, now);
    if (typeof r === 'string') invalid.push(`rules[${i}]: ${r}`);
    else if (rules.has(r.id)) invalid.push(`rules[${i}]: duplicateId`);
    else rules.set(r.id, r);
  });
  const exceptions = new Map<string, Exception>();
  file.exceptions.forEach((raw, i) => {
    const x = parseImportedException(raw, now);
    if (typeof x === 'string') invalid.push(`exceptions[${i}]: ${x}`);
    else if ((exceptions.get(x.videoId)?.at ?? -1) < x.at) exceptions.set(x.videoId, x);
  });
  return { ok: true, value: { rules: [...rules.values()], exceptions: [...exceptions.values()], invalid } };
}
