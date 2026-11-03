// The catalogue lives in src/locales/en.yml (WXT's i18n module reads it from there).
// Every user-facing string goes through t() (REQ-DIST-4).
import { i18n } from '#i18n';

export const t = i18n.t;
