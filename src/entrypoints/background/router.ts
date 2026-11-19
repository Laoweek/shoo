// Message routing: sender checks, payload guards, one route per inbound message. Source of truth:
// docs/spec/architecture.md Section 6 (contract and sender checks) and Section 13 (validate payloads).
import { siteOfUrl } from '~/core/sites';
import type { SiteId } from '~/core/types';
import type { ProtocolMap } from '~/messaging/protocol';
import type { Platform, ToTab } from './platform';

export type Inbound = Exclude<keyof ProtocolMap, ToTab>;
export type Req<K extends Inbound> = Parameters<ProtocolMap[K]>[0];
export type Res<K extends Inbound> = ReturnType<ProtocolMap[K]>;

/** Who may send a message: a content script on a Site, an extension page, or both. */
export type Access = 'content' | 'page' | 'both';

export interface Sender {
  kind: 'content' | 'page';
  /** The Site's tab for content senders. Undefined for pages. */
  tabId?: number;
  /** The Site a content sender runs on. Undefined for pages. */
  site?: SiteId;
  /** The tab is in a private window: nothing is written to local or sync (Section 8). */
  incognito: boolean;
}

export interface Route<K extends Inbound> {
  from: Access;
  /** Payload guard. A failed guard answers `invalid` when the contract has an error shape, else rejects. */
  valid(v: unknown): boolean;
  invalid?: Res<K>;
  run(req: Req<K>, sender: Sender): Promise<Res<K>>;
}

export type Routes = { [K in Inbound]: Route<K> };

/** The subset of runtime.MessageSender the checks read. */
export interface RawSender {
  id?: string;
  url?: string;
  tab?: { id?: number; url?: string; incognito?: boolean };
}

/**
 * Section 6 sender checks. Content: our extension id and a tab on a Site's origin (https://www.youtube.com/* or
 * https://www.bilibili.com/*). Pages: a sender URL under our extension origin. Anything else is undefined (dropped).
 */
export function classifySender(raw: RawSender | undefined, platform: Pick<Platform, 'runtimeId' | 'getURL'>): Sender | undefined {
  if (!raw || raw.id !== platform.runtimeId) return undefined;
  const origin = platform.getURL('/');
  if (typeof raw.url === 'string' && raw.url.startsWith(origin)) return { kind: 'page', incognito: false };
  const tab = raw.tab;
  const site = typeof tab?.url === 'string' ? siteOfUrl(tab.url) : undefined;
  if (tab && typeof tab.id === 'number' && site) {
    return { kind: 'content', tabId: tab.id, site, incognito: tab.incognito === true };
  }
  return undefined;
}

export class DroppedMessage extends Error {
  constructor(type: string) {
    super(`Message ${type} dropped`);
    this.name = 'DroppedMessage';
  }
}

export class InvalidInput extends Error {
  constructor(type: string) {
    super(`invalidInput: ${type}`);
    this.name = 'InvalidInput';
  }
}

export function createDispatch(routes: Routes, platform: Pick<Platform, 'runtimeId' | 'getURL'>) {
  return async function dispatch<K extends Inbound>(type: K, data: unknown, raw: RawSender | undefined): Promise<Res<K>> {
    const route = routes[type] as Route<K> | undefined;
    const sender = classifySender(raw, platform);
    if (!route || !sender || (route.from !== 'both' && route.from !== sender.kind)) throw new DroppedMessage(String(type));
    if (!route.valid(data)) {
      if ('invalid' in route) return route.invalid as Res<K>;
      throw new InvalidInput(String(type));
    }
    return route.run(data as Req<K>, sender);
  };
}
