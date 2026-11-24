// Where the agent's cursor and the highlight on its field are drawn over the live view (lane r42-computer). The page is shown "contain" in the box the view has (BrowserLive keeps the page's shape and may leave
// bars), so a point in the page's pixels (the Space browser's viewport is always 1280 by 800) lands at the same place on the picture: the fit scale and the bars at its sides. Pure, so it is tested.
/** The Space browser draws every page at this size (images/space-browser/browserd/profiles.ts VIEWPORT), so the live view and the agent's points share it. */
export const PAGE_VIEW = { width: 1280, height: 800 } as const;

export interface PointerView {
  seq: number;
  tool: string;
  x: number;
  y: number;
  box?: { x: number; y: number; w: number; h: number };
  label?: string;
  at: number;
}
export interface Drawn {
  x: number;
  y: number;
  ring?: { left: number; top: number; width: number; height: number };
  label?: string;
}

export function drawnAt(
  p: PointerView,
  box: { width: number; height: number },
  frame: { width: number; height: number } = PAGE_VIEW,
): Drawn | null {
  if (box.width <= 0 || box.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const k = Math.min(box.width / frame.width, box.height / frame.height);
  const ox = (box.width - frame.width * k) / 2,
    oy = (box.height - frame.height * k) / 2;
  const at = (v: number, o: number): number => o + v * k;
  return {
    x: Math.round(at(p.x, ox)),
    y: Math.round(at(p.y, oy)),
    ...(p.box
      ? {
          ring: {
            left: Math.round(at(p.box.x, ox)),
            top: Math.round(at(p.box.y, oy)),
            width: Math.max(4, Math.round(p.box.w * k)),
            height: Math.max(4, Math.round(p.box.h * k)),
          },
        }
      : {}),
    ...(p.label ? { label: p.label } : {}),
  };
}

/** How long a cursor stays after the agent's last action: it fades, so a stale one never points at something the agent is no longer doing. */
export const CURSOR_SHOWN_MS = 8000;
export const showsCursor = (p: PointerView | null, now: number): boolean => p !== null && now - p.at < CURSOR_SHOWN_MS;
