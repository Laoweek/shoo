// What a Site tells Shoo's content engine (docs/spec/architecture.md Section 4, ADR 0011). A Site knows its own
// markup: where its Tiles are and what they show, how its Tile menu opens and closes, and what its removed-Tile
// placeholder looks like. The engine in src/content/ does everything else the same way on every Site: observing,
// batching, judging through the background, the NativeActionQueue with focus safety, and Shoo's in-page UI.
import type { NativeAction, ShelfId, SiteId, SurfaceId, TileFacts } from '~/core/types';

export type MarkupField = 'videoId' | 'title';
export type MarkupWarning = (field: MarkupField, surface: SurfaceId) => void;

/** One Surface. Unsupported ones stay listed with `supported: false` so Settings can show them disabled (REQ-SURF-1a). */
export interface SurfaceDef {
  id: SurfaceId;
  supported: boolean;
  reason?: string; // i18n key shown in Settings when unsupported
  /** Not every page of the Surface holds it (YouTube's Shorts shelf): the markup self-test leaves it out. */
  optional?: boolean;
  /** Its containers arrive inside another Surface's containers: the watcher follows that Surface's structure too. */
  nestedIn?: SurfaceId;
  matches(loc: Location, page: Element): boolean;
  containers(page: Element): Element[]; // resolved fresh after every navigation
  tiles(container: Element): Element[];
  /** The video the Tile element shows now, or null. Cheap: read on every scan to notice reuse. */
  videoId(tile: Element): string | null;
  /** The Tile's title, or null. Shared by extraction and the markup self-test. */
  title(tile: Element): string | null;
  /** TileFacts, or null to skip the Tile (ads, playlists, the playing video). Reads the DOM only. */
  extract(tile: Element, doc: Document, warn?: MarkupWarning): TileFacts | null;
  /** Attributes that change when the site reuses the Tile element for another video. */
  reuseTargets(tile: Element): Array<{ el: Element | null; attributes: string[] }>;
  /** The Tile's first send waits while this holds (a badge icon that has not rendered yet). */
  badgePending?(tile: Element): boolean;
  /** The element the site's removed-Tile placeholder appears in. */
  actionRoot(tile: Element): Element | null;
  /** Geometry source for the chip. */
  thumbnail(tile: Element): Element | null;
  /** The site's own badges over the thumbnail (duration, LIVE, view counts), which Shoo's chip never covers. */
  badges(thumbnail: Element): Element[];
  /** Where Shoo's host element is appended: outside any thumbnail link, a containing block. */
  mountParent(tile: Element): Element | null;
  /** Chips go in the page-level overlay: a page-level layer (a hover preview) draws over the Tile. */
  overlay?: boolean;
  menuButton(tile: Element): HTMLElement | null;
  /** Where focus goes on Esc from a chip. */
  focusReturn(tile: Element): HTMLElement | null;
  actions: NativeAction[];
  selectorVersion: string;
}

/** What tells one opening of a menu element from the next. */
export interface MenuSignature {
  first: Element | null;
  pos: string;
}

/** The Tile menu that holds the Native actions. Only src/content/actions.ts drives it. */
export interface SiteMenu {
  /** Every element that can be this site's Tile menu, open or not. */
  menus(doc: Document): Element[];
  /** Open on positive evidence only. */
  isOpen(menu: Element): boolean;
  /**
   * One menu element serves every Tile (YouTube): a menu that was already open, or that opens showing its previous
   * content, belongs to Shoo's opening only once its items or place changed. Without it (Bilibili, one menu per Tile)
   * a menu that was closed before Shoo opened one and is open now is Shoo's.
   */
  shared: boolean;
  signature(menu: Element): MenuSignature;
  /** Open the Tile's menu from its button (YouTube: a click, Bilibili: hovering it). */
  open(button: HTMLElement): void;
  /**
   * Menus that open on hover (Bilibili): a selector for the menu buttons. The user's pointer entering one while Shoo
   * opens a menu may open another Tile's menu, so the job stops without clicking. Click menus need none: a pointer
   * press already counts as the user's.
   */
  hoverTrigger?: string;
  /** Close a menu Shoo opened. `button` is the button Shoo opened it from, when known. */
  close(menu: Element, button: HTMLElement | null): void;
  /** The job is over: undo anything opening left behind on the button (Bilibili's hover). */
  release?(button: HTMLElement): void;
  /**
   * The item for `action`, never by position. Without `byText` only by a language-independent mark (YouTube's icon
   * path, which renders late, so the queue polls), with `byText` by the built-in localized labels.
   */
  findItem(menu: Element, action: NativeAction, byText: boolean): Element | null;
  clickTarget(item: Element): HTMLElement | null;
}

/** The site's own removed-Tile placeholder, inside actionRoot, and its Undo (REQ-ACT-4). */
export interface SitePlaceholder {
  /** The placeholder while it shows, or null. */
  find(actionRoot: Element): Element | null;
  /** The Tile's own content shows again (after Undo). */
  restored(actionRoot: Element): boolean;
  /** How the Undo watch observes actionRoot to see the placeholder come and go. */
  observe: MutationObserverInit;
  /** The site's Undo button inside the placeholder (language-independent). */
  undoButton(placeholder: Element): HTMLElement | null;
  /** The placeholder's card: its outline and padding give the column Shoo's annotation spans. */
  card(placeholder: Element): Element | null;
  /** The site's visible sentence ("Video removed"). */
  sentence(placeholder: Element): Element | null;
  /** The site's own actions in the placeholder (Undo, Tell us why), which the annotation never covers. */
  actions(placeholder: Element): Element[];
  /** The placeholder says the channel was removed (Don't recommend channel). */
  isChannel(placeholder: Element): boolean;
  /** The placeholder shows the thumbnail behind it: the annotation brings its own surface. */
  overPicture: boolean;
}

/** A Native action on something other than a Tile, such as a Shelf dismissal. Run by the content engine's queue. */
export interface TargetJob {
  /** Focus inside it holds the job. Focus the site moves into it during the job goes back (scroll guard). */
  scope: Element;
  /** Still there and not acted on yet. Checked together with the page and URL before every attempt. */
  valid(): boolean;
  /** What to click: a menu button (`menu: true`), or the control that acts by itself. */
  control(): { el: HTMLElement; menu: boolean } | null;
  /** The item in the open menu. `byText`: the fallback labels, tried once the icons had 3 s to render. */
  item(menu: Element, byText: boolean): Element | null;
  /** The site confirmed the action. */
  done(): boolean;
  /** Background re-validation right before acting. false: 'stale'. */
  precheck?(): Promise<boolean>;
}

export interface ShelfWatcher {
  setEnabled(on: Partial<Record<ShelfId, boolean>>): void;
  stop(): void;
}

/** The site's Shelves that its own control dismisses (REQ-ACT-6). Only YouTube has them. */
export interface SiteShelves {
  /**
   * Offers each switched-on Shelf to `onShelf` once per page, once its Tiles and dismiss control show. `onShelf`
   * resolves false when the attempt did not count (stale or cancelled): the Shelf is offered again later.
   */
  watch(doc: Document, onShelf: (shelf: Element, id: ShelfId) => Promise<boolean>): ShelfWatcher;
  /** The queue job that dismisses one Shelf. */
  target(shelf: Element, id: ShelfId, precheck?: () => Promise<boolean>): TargetJob;
}

export interface UserBanOptions {
  doc: Document;
  /** The watcher's Surface lookup: only Tiles on watched Surfaces of the visible page are known. */
  surfaceOf(el: Element): SurfaceId | undefined;
  /** The site replaced the Tile with its Don't recommend channel placeholder after the user's own click. */
  onBan(tileEl: Element, facts: TileFacts): void;
}

export interface Site {
  id: SiteId;
  selectorVersion: string;
  surfaces: Readonly<Partial<Record<SurfaceId, SurfaceDef>>>;
  /** The page every query is scoped to (YouTube keeps hidden copies of pages you left). */
  visiblePage(doc: Document): Element | null;
  /** In-app navigation finished: the watcher binds the new page. */
  navigatedEvents: readonly string[];
  /** In-app navigation started or finished: Undo watches and the scroll guard end, navigation is never Undo. */
  leavingEvents: readonly string[];
  /** Backup for missed navigation events: the element whose children are the site's pages. */
  pageSwitcher?(doc: Document): Element | null;
  /** REQ-SURF-3: the element shows the playing video, or sits in the playing queue. */
  isPlayingOrQueued(tile: Element, videoId: string, doc: Document): boolean;
  menu: SiteMenu;
  placeholder: SitePlaceholder;
  isDark(doc: Document): boolean;
  /** Calls `cb` whenever the site switches theme. Returns a disposer. */
  observeTheme(doc: Document, cb: (dark: boolean) => void): () => void;
  /** Distance to keep Shoo's summary and notices above a site layer at the viewport's bottom (px, 0 for none). */
  dockLift?(doc: Document): number;
  /** REQ-ACT-5: calls `onBan` when the user removes a Tile with the site's own Don't recommend channel. Returns a disposer. */
  watchUserBans?(opts: UserBanOptions): () => void;
  shelves?: SiteShelves;
}

/** The site's supported Surfaces that are enabled and match the visible page. Empty means: attach no Tile observers. */
export function activeSurfaces(site: Site, loc: Location, doc: Document, enabled: Partial<Record<SurfaceId, boolean>>): SurfaceDef[] {
  const page = site.visiblePage(doc);
  if (!page) return [];
  return Object.values(site.surfaces).filter((d): d is SurfaceDef => !!d && d.supported && enabled[d.id] === true && d.matches(loc, page));
}

/** The Surface definition for an id the site owns. */
export function surfaceOf(site: Site, id: SurfaceId): SurfaceDef {
  const def = site.surfaces[id];
  if (!def) throw new Error(`${site.id} has no Surface ${id}`);
  return def;
}

/** `13:54` → 834, `01:02:03` → 3723. Digits and colons only, so it is language-independent. */
export function parseDuration(text: string | null | undefined): number | undefined {
  const t = text?.trim();
  if (!t || !/^\d{1,3}(:\d{2}){1,2}$/.test(t)) return undefined;
  return t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}
