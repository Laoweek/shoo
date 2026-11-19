// Small text helpers shared by page and in-page components.

/** P(remove) 0..1 as a whole percent string: 0.912 -> "91". */
export const percent = (p: number) => String(Math.round(p * 100));
