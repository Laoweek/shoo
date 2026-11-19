// Data every Settings section reads (docs/spec/ui-design.md Section 6), loaded once by the App and refreshed
// by storage watchers.
import { createContext } from 'preact';
import type { Exception, ReasonCode, Rule, RuntimeSnapshot, Settings } from '~/core/types';
import type { KeyUsage } from '~/messaging/protocol';
import type { Section } from '~/ui/pages/nav';

export interface PageData {
  settings?: Settings;
  rules?: Rule[];
  exceptions?: Exception[];
  runtime?: RuntimeSnapshot;
  /** A storage read failed (shown as the section's error state). */
  loadError: boolean;
  /** readExceptions failed. */
  exceptionsError: boolean;
  /** Consent for the active engine (and its host for a direct or custom endpoint). */
  consent: boolean;
  /** Consent and a key: Topic and Thumbnail rules can work. */
  modelOk: boolean;
  /** getKeyUsage: the key's label, connect date, usage and limit, or why there is none. */
  key?: KeyUsage | { error: ReasonCode };
  keyStatus: 'connected' | 'rejected' | 'none' | 'unknown';
  refreshKey: () => void;
  refreshRuntime: () => void;
  go: (section: Section, query?: string) => void;
}

export interface SectionProps {
  data: PageData;
  params: URLSearchParams;
}

/** Lets sections move the wordmark's eyes: sweep while typing in Try a title, widen on a hovered Rule. */
export const EyesControl = createContext<{ reading: (on: boolean) => void; wide: (on: boolean) => void }>({
  reading: () => {},
  wide: () => {},
});
