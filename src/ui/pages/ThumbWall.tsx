// Thumbnail wall: removed or kept videos at 64 x 36 (Rules and Keep rules expanded row, Activity thumbnail view).
// Thumbnails load from i.ytimg.com on the extension page only, never through the background.
import type { ColourCode } from '~/core/types';
import { Swatch } from '../components';
import { thumbUrl } from './format';

export interface WallItem {
  id: string;
  videoId: string;
  title: string;
  colour?: ColourCode;
}

export function ThumbWall({ items, label, class: cls }: { items: WallItem[]; label: string; class?: string }) {
  return (
    <ul aria-label={label} class={`m-0 flex list-none flex-wrap gap-2 p-0 ${cls ?? ''}`}>
      {items.map((v) => (
        <li key={v.id} class="relative h-9 w-16 overflow-hidden rounded-[4px] bg-lit">
          <img src={thumbUrl(v.videoId)} alt={v.title} title={v.title} width={64} height={36} loading="lazy" decoding="async" class="block h-9 w-16 object-cover" />
          {v.colour && <Swatch colour={v.colour} class="absolute top-1 left-1" />}
        </li>
      ))}
    </ul>
  );
}
