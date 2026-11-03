// Number, money, time and day formatting for extension pages. Counts, costs and times render in
// tabular figures (the `num` class), see docs/spec/ui-design.md Section 2.
import { dayKey } from '~/core/escalation';
import { t } from '~/i18n';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole numbers with grouping: 5000 -> "5,000". */
export const count = (n: number): string => new Intl.NumberFormat('en').format(n);

/** Spend in US dollars. Zero shows as "$0", small amounts keep three decimals: 0.0021 -> "$0.002". */
export function money(usd: number): string {
  if (!usd) return '$0';
  const digits = usd < 0.1 ? 3 : 2;
  return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: digits }).format(usd);
}

/** Local time of day, "21:42". */
export const clock = (at: number): string => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

/** Short local date, "9 Oct 2026". */
export const date = (at: number): string => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(at);

/** Day label for Activity guides: Today, Yesterday, or "Wed 7 Oct". */
export function dayLabel(day: string, now: number): string {
  if (day === dayKey(now)) return t('activity.today');
  if (day === dayKey(now - DAY_MS)) return t('activity.yesterday');
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y!, m! - 1, d!));
}

/** "Today 21:42", "Yesterday 08:10" or "9 Oct 2026" for a last-hit time. */
export function when(at: number, now: number): string {
  const day = dayKey(at);
  if (day === dayKey(now) || day === dayKey(now - DAY_MS)) return `${dayLabel(day, now)} ${clock(at)}`;
  return date(at);
}

/** First local day of "this week": today and the 6 days before it (matches hitsThisWeek). */
export function weekStart(now: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 6);
  return dayKey(d.getTime());
}

/** Thumbnail for a video on an extension page (64 x 36 walls, Activity rows). */
export const thumbUrl = (videoId: string): string => `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
