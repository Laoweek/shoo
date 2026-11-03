import { t } from '~/i18n';

export interface SkeletonRowsProps {
  rows?: number;
  /** Accessible loading text. Defaults to "Loading…". */
  label?: string;
  class?: string;
}

/** Static 40 px placeholder rows on --line rules. No shimmer: Shoo stays calm while loading. */
export function SkeletonRows({ rows = 3, label, class: cls }: SkeletonRowsProps) {
  return (
    <div role="status" aria-busy="true" class={cls}>
      <span class="sr-only">{label ?? t('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" class="flex h-10 items-center gap-3 border-b border-line">
          <span class="h-3 w-10 rounded-[3px] bg-lit" />
          <span class="h-3 rounded-[3px] bg-tint" style={`width:${[52, 38, 46, 30][i % 4]}%`} />
        </div>
      ))}
    </div>
  );
}
