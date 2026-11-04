import { describe, expect, it } from 'vitest';
import { dayKey, dismissEscalation, escalationStatus, pruneEscalation, recordTopicRemoval, totalTopicRemovals, type EscalationRecord } from './escalation';

const emptyEscalation = (): EscalationRecord => ({ judged: {}, topicRemoved: {} });

/** Counts a judged video once per day, as store/local.ts recordEscalationJudged does in its day keys. */
function recordJudged(rec: EscalationRecord, videoId: string, day: string): EscalationRecord {
  const ids = rec.judged[day] ?? [];
  if (ids.includes(videoId)) return rec;
  return { ...rec, judged: { ...rec.judged, [day]: [...ids, videoId] } };
}

let videoSeq = 0;
// Local noon avoids DST edges.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
const NOW = at(2026, 10, 10);
const TODAY = '2026-10-10';

/** Judges `judged` distinct videos and records `removed` Topic removals on one day. */
function build(judged: number, removed: number, day = TODAY, rec = emptyEscalation()): EscalationRecord {
  let out = rec;
  for (let i = 0; i < judged; i++) out = recordJudged(out, `v${++videoSeq}`, day);
  for (let i = 0; i < removed; i++) out = recordTopicRemoval(out, day);
  return out;
}

describe('dayKey', () => {
  it('formats the local date', () => {
    expect(dayKey(at(2026, 1, 5))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12-31');
  });
});

describe('recording', () => {
  it('counts Topic removals per day and keeps records immutable', () => {
    const a = { topicRemoved: {}, name: 'Jake Reacts' };
    const r = recordTopicRemoval(recordTopicRemoval(a, TODAY), TODAY);
    expect(r).toEqual({ topicRemoved: { [TODAY]: 2 }, name: 'Jake Reacts' });
    expect(a.topicRemoved).toEqual({});
  });
});

describe('escalationStatus (REQ-ESC-1 to 3)', () => {
  it.each<[string, number, number, boolean]>([
    ['exactly 3 removals of 6 judged (exactly 50%)', 6, 3, true],
    ['3 removals of 7 judged (under 50%)', 7, 3, false],
    ['2 removals of 2 judged (under 3 removals)', 2, 2, false],
    ['4 removals of 5 judged', 5, 4, true],
    ['3 removals with nothing judged in the window', 0, 3, false],
  ])('%s', (_, judged, removed, qualifies) => {
    expect(escalationStatus(build(judged, removed), NOW, false)).toEqual({ qualifies, removed, judged, suppressed: false });
  });

  it('counts distinct videos across days', () => {
    let rec = build(0, 3);
    for (const day of ['2026-10-08', '2026-10-09', TODAY]) rec = recordJudged(rec, 'same', day);
    rec = recordJudged(rec, 'other', TODAY);
    expect(escalationStatus(rec, NOW, false)).toMatchObject({ judged: 2, qualifies: true });
  });

  it('a channel with a Keep rule or Exception never escalates', () => {
    expect(escalationStatus(build(4, 4), NOW, true)).toMatchObject({ qualifies: false, removed: 4 });
  });

  it('only counts the last 30 local days, today included', () => {
    const inside = build(2, 2, '2026-09-11'); // 29 days before today
    const rec = build(1, 1, '2026-09-10', inside); // 30 days before: outside
    expect(escalationStatus(rec, NOW, false)).toMatchObject({ removed: 2, judged: 2, qualifies: false });
    expect(escalationStatus(build(1, 1, TODAY, rec), NOW, false)).toMatchObject({ removed: 3, judged: 3, qualifies: true });
  });

  it('after "Not now", suggests again only after 3 more removals', () => {
    let rec = dismissEscalation(build(4, 3), NOW);
    expect(rec).toMatchObject({ dismissedAt: NOW, removalsAtDismiss: 3 });
    expect(escalationStatus(rec, NOW, false)).toMatchObject({ qualifies: false, suppressed: true });
    rec = build(2, 2, TODAY, rec);
    expect(escalationStatus(rec, NOW, false)).toMatchObject({ qualifies: false, suppressed: true, removed: 5 });
    rec = recordTopicRemoval(rec, TODAY);
    expect(escalationStatus(rec, NOW, false)).toEqual({ qualifies: true, suppressed: false, removed: 6, judged: 6 });
  });

  it('a dismissal without a stored count treats it as zero', () => {
    const rec: EscalationRecord = { ...build(4, 3), dismissedAt: NOW };
    expect(escalationStatus(rec, NOW, false)).toMatchObject({ qualifies: true, suppressed: false });
  });
});

describe('pruneEscalation', () => {
  it('drops days older than the window and keeps the re-suggest count right', () => {
    let rec = build(3, 3, '2026-09-01');
    rec = dismissEscalation(rec, at(2026, 9, 1));
    rec = build(2, 2, TODAY, rec);
    const pruned = pruneEscalation(rec, NOW);
    expect(Object.keys(pruned.judged)).toEqual([TODAY]);
    expect(pruned.topicRemoved).toEqual({ [TODAY]: 2 });
    expect(pruned.removalsAtDismiss).toBe(0);
    expect(totalTopicRemovals(pruned) - pruned.removalsAtDismiss!).toBe(2); // same as before pruning
    expect(rec.judged['2026-09-01']).toHaveLength(3); // input untouched
  });

  it('leaves records without a dismissal alone apart from old days', () => {
    const rec = { ...build(1, 1), name: 'Jake Reacts', handle: 'jakereacts' };
    expect(pruneEscalation(rec, NOW)).toEqual(rec);
  });
});
