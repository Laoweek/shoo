// Shared components for extension pages (popup, Settings, onboarding). Tailwind classes on the
// token theme from src/ui/pages.css. In-page UI on YouTube lives in src/ui/in-page/ instead.
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { Switch, type SwitchProps } from './Switch';
export { Segmented, type SegmentedProps, type SegmentedOption } from './Segmented';
export { Swatch, type SwatchProps } from './Swatch';
export { RuleRef, ruleLabel, type RuleLike, type RuleRefProps } from './RuleRef';
export { VerdictPill, type VerdictPillProps } from './VerdictPill';
export { Wordmark, eyeStatusText, type WordmarkProps } from './Wordmark';
export { Eyes, type EyesProps } from './Eyes';
export { SkeletonRows, type SkeletonRowsProps } from './Skeleton';
export { Notice, type NoticeProps, type NoticeAction } from './Notice';
