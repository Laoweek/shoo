// Shoo's shadow roots are closed, so a page script cannot read Rule text through `host.shadowRoot` or press Shoo's
// buttons (docs/spec/ui-design.md Section 4). Shoo keeps its own handle to each root here.
const roots = new WeakMap<Element, ShadowRoot>();

/** Attach a closed shadow root to one of Shoo's host elements and remember it. */
export function attachShooRoot(host: Element): ShadowRoot {
  const root = host.attachShadow({ mode: 'closed' });
  roots.set(host, root);
  return root;
}

/** The shadow root of one of Shoo's hosts, else the element's open root (the site's own components), else null. */
export const shadowRootOf = (el: Element): ShadowRoot | null => roots.get(el) ?? el.shadowRoot;
