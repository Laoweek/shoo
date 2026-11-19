// The only accessors for the API keys (key isolation, REQ-MODEL-6, docs/spec/architecture.md Section 4
// rule 3). Imported only by engine/ and the background router. Never log the values.
import { browserAreas, getOne, isRecord, type AreaLike } from './areas';

export interface OpenRouterKey {
  key: string;
  source: 'oauth' | 'pasted';
  label?: string;
  connectedAt: number;
}

export interface CustomKey {
  key: string;
}

const OPENROUTER_KEY = 'secret:openrouterKey';
const CUSTOM_KEY = 'secret:customKey';

const localArea = (local?: AreaLike) => local ?? browserAreas().local;

function isOpenRouterKey(v: unknown): v is OpenRouterKey {
  return isRecord(v) && typeof v.key === 'string' && v.key.length > 0 && (v.source === 'oauth' || v.source === 'pasted') && typeof v.connectedAt === 'number';
}

export async function getOpenRouterKey(local?: AreaLike): Promise<OpenRouterKey | undefined> {
  const v = await getOne<unknown>(localArea(local), OPENROUTER_KEY);
  return isOpenRouterKey(v) ? v : undefined;
}

export async function setOpenRouterKey(value: OpenRouterKey, local?: AreaLike): Promise<void> {
  if (!isOpenRouterKey(value)) throw new TypeError('Invalid OpenRouter key record');
  await localArea(local).set({ [OPENROUTER_KEY]: value });
}

export async function clearOpenRouterKey(local?: AreaLike): Promise<void> {
  await localArea(local).remove(OPENROUTER_KEY);
}

export async function hasOpenRouterKey(local?: AreaLike): Promise<boolean> {
  return (await getOpenRouterKey(local)) !== undefined;
}

export async function getCustomKey(local?: AreaLike): Promise<CustomKey | undefined> {
  const v = await getOne<unknown>(localArea(local), CUSTOM_KEY);
  return isRecord(v) && typeof v.key === 'string' ? { key: v.key } : undefined;
}

export async function setCustomKey(value: CustomKey, local?: AreaLike): Promise<void> {
  if (typeof value.key !== 'string') throw new TypeError('Invalid custom key record');
  await localArea(local).set({ [CUSTOM_KEY]: { key: value.key } });
}

export async function clearCustomKey(local?: AreaLike): Promise<void> {
  await localArea(local).remove(CUSTOM_KEY);
}

/** The key for a Decision provider reached directly (Cloudflare API token, TypeSafe or Perplexity key). Empty for a model on this computer. */
const DIRECT_KEY = 'secret:directKey';

export async function getDirectKey(local?: AreaLike): Promise<CustomKey | undefined> {
  const v = await getOne<unknown>(localArea(local), DIRECT_KEY);
  return isRecord(v) && typeof v.key === 'string' ? { key: v.key } : undefined;
}

export async function setDirectKey(value: CustomKey, local?: AreaLike): Promise<void> {
  if (typeof value.key !== 'string') throw new TypeError('Invalid direct key record');
  await localArea(local).set({ [DIRECT_KEY]: { key: value.key } });
}

export async function clearDirectKey(local?: AreaLike): Promise<void> {
  await localArea(local).remove(DIRECT_KEY);
}
