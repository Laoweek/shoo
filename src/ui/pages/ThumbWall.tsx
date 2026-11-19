// Thumbnail wall: removed or kept videos at 64 x 36 (Rules and Keep rules expanded row, Activity thumbnail view).
// Thumbnails load from i.ytimg.com or Bilibili's image host on the extension page only, never through the background,
// and without a referrer.
import type { ColourCode } from '~/core/types';
import { Swatch } from '../components';
import { thumbUrl } from './format';

export interface WallItem {
  id: string;
  videoId: string;
  /** Bilibili's cover path (ActivityEvent.cover). */
  cover?: string;
  title: string;
  colour?: ColourCode;
}

export function ThumbWall({ items, label, class: cls }: { items: WallItem[]; label: string; class?: string }) {
  return (
    <ul aria-label={label} class={`m-0 flex list-none flex-wrap gap-2 ${cls ?? 'p-0'}`}>
      {items.map((v) => {
        const src = thumbUrl(v.videoId, v.cover);
        return (
          <li key={v.id} class="relative h-9 w-16 overflow-hidden rounded-[6px] bg-tint" title={src ? undefined : v.title}>
            {src && <img src={src} alt={v.title} title={v.title} width={64} height={36} loading="lazy" decoding="async" referrerpolicy="no-referrer" class="block h-9 w-16 object-cover" />}
            {v.colour && <Swatch colour={v.colour} class="absolute top-1 left-1" />}
          </li>
        );
      })}
    </ul>
  );
}
