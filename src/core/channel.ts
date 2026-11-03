// ChannelKey and channel identity. Source of truth: docs/spec/architecture.md Section 10.
import type { Rule, TileFacts } from './types';

/** Normalized channel name: NFKC, casefolded, trimmed, inner whitespace collapsed. */
export function channelKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('en').trim().replace(/\s+/g, ' ');
}

export interface ChannelIdentity {
  key?: string;
  handle?: string;
  id?: string;
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
  if (a.id && b.id) return a.id === b.id;
  if (a.handle && b.handle) return a.handle === b.handle;
  if (a.key && b.key) return a.key === b.key;
  return false;
}

/** A channel Rule's identity from its params. The channel name falls back to the Rule text. */
export function ruleChannelIdentity(rule: Rule): ChannelIdentity | undefined {
  const p = rule.params ?? {};
  return channelIdentity(p.channelName ?? rule.text, p.handle, p.channelId);
}

export function tileChannelIdentity(t: TileFacts): ChannelIdentity | undefined {
  return channelIdentity(t.channelName, t.channelHandle, t.channelId);
}
