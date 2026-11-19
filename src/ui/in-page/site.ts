// The name of the Site the in-page UI runs on, for copy such as "Couldn't tell Bilibili about 1 video". Set once by
// the content script when its UI mounts. Defaults to YouTube, the Site Shoo was built for.
let name = 'YouTube';

export const siteName = (): string => name;

export function setSiteName(next: string): void {
  name = next;
}
