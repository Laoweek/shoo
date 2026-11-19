// Shelf dismissal results (docs/spec/youtube-integration.md Section 10, REQ-ACT-6). Content reports only a
// dismissal that worked, so it never moves the Native action or markup failure counters.
import { newId } from '~/core/ids';
import { isRecord, isShelf } from '../guards';
import type { Routes } from '../router';
import type { Services } from '../services';

export function shelfRoutes(s: Services): Pick<Routes, 'reportShelfDismissal'> {
  return {
    reportShelfDismissal: {
      from: 'content',
      valid: (v) => isRecord(v) && isShelf(v.shelf),
      run: ({ shelf }, sender) => s.writer.recordActivity([{ id: newId(), kind: 'shelfDismissed', at: s.now(), surface: 'home', shelf }], s.privacy(sender)),
    },
  };
}
