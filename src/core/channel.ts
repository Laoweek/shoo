// ChannelKey and channel identity. Source of truth: docs/spec/architecture.md Section 10.
import { SURFACE_SITE, type SiteId } from './sites';
import type { Rule, RuleParams, TileFacts } from './types';

/** Normalized channel name: NFKC, casefolded, trimmed, inner whitespace collapsed. */
export function channelKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('en').trim().replace(/\s+/g, ' ');
}

export interface ChannelIdentity {
  key?: string;
  handle?: string;
  id?: string;
  /** Known for Tiles, and for channel Rules limited to one Site. Two identities on different Sites never match. */
  site?: SiteId;
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLocaleLowerCase('en');
}

/**
 * Builds an identity from whatever the caller knows. Empty parts are dropped. The handle is lowercased
 * without '@'. Returns undefined when nothing is left, so a Tile without a channel has no identity.
 */
export function channelIdentity(name?: string, handle?: string, id?: string): ChannelIdentity | undefined {
  const identity: ChannelIdentity = {};
  const key = name === undefined ? '' : channelKey(name);
  const h = handle === undefined ? '' : normalizeHandle(handle);
  const i = id === undefined ? '' : id.trim();
  if (key) identity.key = key;
  if (h) identity.handle = h;
  if (i) identity.id = i;
  return identity.key || identity.handle || identity.id ? identity : undefined;
}

/** Section 10 order: by id when both have one, else by handle when both have one, else by key. */
export function channelsMatch(a: ChannelIdentity, b: ChannelIdentity): boolean {
  if (a.site && b.site && a.site !== b.site) return false;
  if (a.id && b.id) return a.id === b.id;
  if (a.handle && b.handle) return a.handle === b.handle;
  if (a.key && b.key) return a.key === b.key;
  return false;
}

/**
 * The Site a channel's handle or id belongs to: only YouTube has handles, and its channel ids start with "UC". Bilibili
 * ids are numbers. Channel Rules saved before Sites carry no Site, only these.
 */
export function channelIdSite(p: RuleParams | undefined): SiteId | undefined {
  if (p?.handle) return 'youtube';
  if (p?.channelId) return /^\d+$/.test(p.channelId) ? 'bilibili' : 'youtube';
  return undefined;
}

/** A channel Rule's identity from its params and Site. The channel name falls back to the Rule text. */
export function ruleChannelIdentity(rule: Rule): ChannelIdentity | undefined {
  const p = rule.params ?? {};
  return withSite(channelIdentity(p.channelName ?? rule.text, p.handle, p.channelId), rule.site ?? channelIdSite(p));
}

export function tileChannelIdentity(t: TileFacts): ChannelIdentity | undefined {
  return withSite(channelIdentity(t.channelName, t.channelHandle, t.channelId), SURFACE_SITE[t.surface]);
}

const withSite = (identity: ChannelIdentity | undefined, site: SiteId | undefined): ChannelIdentity | undefined =>
  identity && site ? { ...identity, site } : identity;
