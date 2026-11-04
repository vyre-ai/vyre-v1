// Notes, the icons: thin strokes on an 18 grid, the set the approved prototype draws. `Ico` draws one inline on the web; `icoSvg` gives the same drawing as markup for ui/Menu rows.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

export const PATHS = {
  chat: '<path d="M3 4h12v9H8l-3 2.4V13H3z"/>',
  note: '<path d="M4 3h10v8l-4 4H4zM14 11h-4v4"/>',
  pin: '<path d="M7 2.5h4l-.5 4.3L13 9v1.6H5V9l2.5-2.2zM9 10.6v4.9"/>',
  pinf: '<path d="M7 2.5h4l-.5 4.3L13 9v1.6H5V9l2.5-2.2z" fill="currentColor"/><path d="M9 10.6v4.9"/>',
  tag: '<path d="M2.8 9.2V3.5a.7.7 0 01.7-.7h5.7l6 6-6.4 6.4z"/><circle cx="6" cy="6" r="1"/>',
  palette: '<path d="M9 2.8a6.2 6.2 0 100 12.4c1 0 1.4-.6 1.4-1.3 0-.9-.8-1.2-.8-2.1 0-.8.6-1.3 1.4-1.3h1.6a2.8 2.8 0 002.8-2.8C15.4 5.1 12.6 2.8 9 2.8z"/><circle cx="5.8" cy="8.4" r=".8" fill="currentColor"/><circle cx="8" cy="5.7" r=".8" fill="currentColor"/><circle cx="11.3" cy="6.1" r=".8" fill="currentColor"/>',
  image: '<rect x="2.8" y="3.8" width="12.4" height="10.4" rx="1.5"/><circle cx="6.5" cy="7.3" r="1.2"/><path d="M3 13l4-4 3 3 2-2 3 3"/>',
  share: '<circle cx="7" cy="6.5" r="2.6"/><path d="M2.8 14.5c.5-3 2-4.2 4.2-4.2 1.3 0 2.3.4 3.1 1.3M13.5 9.5v5M11 12h5"/>',
  trash: '<path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 10h6.6L13 5"/>',
  clip: '<circle cx="5" cy="5" r="2"/><circle cx="5" cy="13" r="2"/><path d="M6.6 6.2L15 13M6.6 11.8L15 5"/>',
  record: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M6 7h6M6 10h4"/>',
  ask: '<path d="M3 4h12v9H8l-3 2.4V13H3z"/><path d="M7.4 7.1a1.7 1.7 0 113 1.1c-.6.4-1.4.6-1.4 1.4M9 11.2v.1"/>',
  task: '<circle cx="9" cy="9" r="6"/><path d="M6.4 9.2L8.2 11 11.8 7"/>',
  open: '<path d="M10 3h5v5M15 3l-7 7M13 10.5V15H3V5h4.5"/>',
  grid: '<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="10" y="3" width="5" height="5" rx="1"/><rect x="3" y="10" width="5" height="5" rx="1"/><rect x="10" y="10" width="5" height="5" rx="1"/>',
  search: '<circle cx="8" cy="8" r="4.6"/><path d="M11.5 11.5L15 15"/>',
  plus: '<path d="M9 3.5v11M3.5 9h11"/>',
  more: '<circle cx="4" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="14" cy="9" r="1" fill="currentColor"/>',
  chev: '<path d="M7 4.5L11.5 9 7 13.5"/>',
  back: '<path d="M11 4.5L6.5 9l4.5 4.5"/>',
  x: '<path d="M5 5l8 8M13 5l-8 8"/>',
  check: '<path d="M4 9.5l3.2 3.2L14 5.5"/>',
  copy: '<path d="M6 6h8v9H6zM4 12V3h7"/>',
  edit: '<path d="M4 14l.8-3L12 3.8l2.2 2.2L7 13.2z"/>',
  globe: '<circle cx="9" cy="9" r="6"/><path d="M3 9h12M9 3c4 3.6 4 8.4 0 12M9 3c-4 3.6-4 8.4 0 12"/>',
  people: '<circle cx="7" cy="6.5" r="2.6"/><path d="M2.8 14.5c.5-3 2-4.2 4.2-4.2s3.7 1.2 4.2 4.2M11.5 4.2a2.5 2.5 0 010 4.8M12.8 10.6c1.3.5 2.1 1.6 2.4 3.9"/>',
  lock: '<path d="M5 8h8v7H5zM6.5 8V6a2.5 2.5 0 015 0v2"/>',
  link: '<path d="M7.5 10.5l3-3M8 5.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M10 12.5l-1 1A2.5 2.5 0 015.5 10l1-1"/>',
  spark: '<path d="M9 3v3M9 12v3M3 9h3M12 9h3M5 5l2 2M11 11l2 2M13 5l-2 2M7 11l-2 2"/>',
  cal: '<path d="M3 5h12v10H3zM3 8h12M6 3v3M12 3v3"/>',
  table: '<path d="M3 4h12v10H3zM3 8h12M8 4v10"/>',
  filter: '<path d="M3 5h12M5.5 9h7M8 13h2"/>',
  list: '<path d="M3 5h12M3 9h12M3 13h12"/>',
} as const;
export type IcoName = keyof typeof PATHS;

const markup = (name: IcoName, size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

/** The icon as markup, for a ui/Menu row (it draws an svg string as given). */
export function icoSvg(name: IcoName, size = 15): string {
  return markup(name, size);
}

/** One icon, inline, in the colour around it (or `color`). Nothing off the web. */
export function Ico({ name, size = 16, color, style }: { name: IcoName; size?: number; color?: string; style?: Record<string, unknown> }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement("span", { "aria-hidden": true, style: { display: "inline-flex", flex: "none", width: size, height: size, color: color ?? "inherit", ...style }, dangerouslySetInnerHTML: { __html: markup(name, size) } });
}
