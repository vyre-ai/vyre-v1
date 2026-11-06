// The one layout model for the desktop shell (DESIGN-SYSTEM-221 section 4). A pure function: window width, what the person asked for (sidebar open, a pane open, an overlay peek) and the widths saved
// for the current band go in; the mode and width of every panel come out. The shell draws exactly this, so panels never overlap except in the overlay modes, main never drops under MAIN_MIN,
// and a window resize only has to call it again.
//
//   [8][rail 56][8][sidebar][8][main][8][side pane][8]     (wide and mid)
//
// Rules: sidebar default 272 (drag 220 to 360); main at least 480, reading width capped at 720; one side pane, default 40% of the room right of the sidebar clamped 360 to 560, drag 320 to 640;
// 1280 and up everything side by side; 1024 to 1279 an open pane folds the sidebar to the rail (it returns when the pane closes); 768 to 1023 the sidebar and the pane are overlay sheets;
// under 768 one panel at a time. When room is short the pane yields first (down to 320), then a drag stops.

export const GUTTER = 8;
export const RAIL_WIDTH = 56;
export const MAIN_MIN = 480;
export const READING_MAX = 720;

export const SIDEBAR = { def: 272, min: 220, max: 360 } as const;
export const PANE = { min: 320, max: 640, defMin: 360, defMax: 560, share: 0.4 } as const;

/** The window width at which each band starts. */
export const BREAKPOINTS = { wide: 1280, mid: 1024, sheet: 768 } as const;

/** The one phone test: a window narrower than BREAKPOINTS.sheet (768) is a phone. Import this instead of writing 640 or 700. */
export const PHONE_BELOW = BREAKPOINTS.sheet;
/** Below the phone width, with no guard for an unmeasured window (0 counts as narrow): for the places that test a raw width. */
export const belowPhone = (windowWidth: number): boolean => windowWidth < PHONE_BELOW;
export const isPhoneWidth = (windowWidth: number): boolean => windowWidth > 0 && windowWidth < PHONE_BELOW;

export type Band = "wide" | "mid" | "sheet" | "phone";
export const BANDS: readonly Band[] = ["wide", "mid", "sheet", "phone"];

export function bandOf(windowWidth: number): Band {
  if (!(windowWidth > 0)) return "wide";
  if (windowWidth >= BREAKPOINTS.wide) return "wide";
  if (windowWidth >= BREAKPOINTS.mid) return "mid";
  if (windowWidth >= BREAKPOINTS.sheet) return "sheet";
  return "phone";
}

/** One docked left panel: the shell's own sidebar, or a list a place puts beside it (Vault's list). */
export interface SidebarSpec { id: string; def: number; min: number; max: number; saved?: number | null }

export interface LayoutInput {
  windowWidth: number;
  /** A place has put a sidebar in the slot. Ignored when `sidebars` lists the left panels. */
  hasSidebar: boolean;
  /** The left panels in order, each with its own default, limits and saved width. Left out: one sidebar (272, 220 to 360). */
  sidebars?: readonly SidebarSpec[];
  /** The person's choice: false after the toggle or Cmd-\. Kept while a pane or a narrow window hides the sidebar. */
  sidebarOpen: boolean;
  /** The sidebar was asked for as an overlay (its toggle in a band that has no room for it). */
  sidebarPeek?: boolean;
  /** A side pane is open. */
  paneOpen: boolean;
  /** The widths the person dragged to, saved for this window's band. */
  saved?: { sidebar?: number | null; pane?: number | null };
}

export type SidebarMode = "none" | "docked" | "hidden" | "overlay" | "screen";
export type PaneMode = "none" | "docked" | "overlay" | "screen";

export interface PanelLimits { min: number; max: number }

export interface Layout {
  band: Band;
  gutter: number;
  rail: { shown: boolean; width: number };
  /** `width` is the whole left group (every panel and the gutters between them); `min` and `max` are the first panel's. */
  sidebar: { mode: SidebarMode; width: number; panels: readonly { id: string; width: number; min: number; max: number }[] } & PanelLimits;
  pane: { mode: PaneMode; width: number; defaultWidth: number } & PanelLimits;
  main: { width: number; reading: number };
  /** The sidebar is open by choice but folded away because a pane is open (the 1024 to 1279 band). */
  folded: boolean;
}

const clamp = (n: number, lo: number, hi: number): number => Math.round(Math.min(Math.max(n, lo), Math.max(lo, hi)));

/** The default width of a side pane: 40% of the room right of the sidebar, 360 to 560. */
export function paneDefault(roomRightOfSidebar: number): number {
  return clamp(roomRightOfSidebar * PANE.share, PANE.defMin, PANE.defMax);
}

export function layoutPanels(input: LayoutInput): Layout {
  const { sidebarOpen, paneOpen } = input;
  const specs: readonly SidebarSpec[] = input.sidebars ?? (input.hasSidebar ? [{ id: "place-sidebar", def: SIDEBAR.def, min: SIDEBAR.min, max: SIDEBAR.max, saved: input.saved?.sidebar ?? null }] : []);
  const hasSidebar = specs.length > 0;
  const band = bandOf(input.windowWidth);
  const W = input.windowWidth > 0 ? input.windowWidth : 1440;
  const G = GUTTER;
  const phone = band === "phone";
  const rail = { shown: !phone, width: phone ? 0 : RAIL_WIDTH };
  // the room right of the rail's gutter: the window less both edges
  const C = phone ? W : W - 2 * G - RAIL_WIDTH - G;
  const savedPane = input.saved?.pane ?? null;

  if (phone) {
    return {
      band, gutter: G, rail,
      sidebar: { mode: hasSidebar ? "screen" : "none", width: W, min: W, max: W, panels: specs.map((sp) => ({ id: sp.id, width: W, min: W, max: W })) },
      pane: { mode: paneOpen ? "screen" : "none", width: W, defaultWidth: W, min: W, max: W },
      main: { width: W, reading: Math.min(W, READING_MAX) },
      folded: false,
    };
  }

  const dockable = band === "wide" || band === "mid";
  const folded = band === "mid" && hasSidebar && sidebarOpen && paneOpen;
  const sbDocked = dockable && hasSidebar && sidebarOpen && !folded;
  const sbOverlay = hasSidebar && !sbDocked && input.sidebarPeek === true;
  const sbMode: SidebarMode = !hasSidebar ? "none" : sbDocked ? "docked" : sbOverlay ? "overlay" : "hidden";

  // the left group may grow until a pane at its floor and main at its floor still fit beside it; past that the last panels give way to their floors
  const groupGaps = Math.max(0, specs.length - 1) * G;
  const groupCap = sbMode === "overlay" ? C : C - G - MAIN_MIN - (paneOpen && dockable ? G + PANE.min : 0);
  const widths = specs.map((sp) => clamp(sp.saved ?? sp.def, sp.min, sp.max));
  for (let i = widths.length - 1; i >= 0 && widths.reduce((a, b) => a + b, 0) + groupGaps > groupCap; i--) {
    const over = widths.reduce((a, b) => a + b, 0) + groupGaps - groupCap;
    widths[i] = Math.max((specs[i] as SidebarSpec).min, (widths[i] as number) - over);
  }
  const sbWidth = widths.reduce((a, b) => a + b, 0) + groupGaps;
  const panels = specs.map((sp, i) => ({ id: sp.id, width: widths[i] as number, min: sp.min, max: Math.max(sp.min, Math.min(sp.max, groupCap - (sbWidth - (widths[i] as number)))) }));
  const first = panels[0] ?? { min: SIDEBAR.min, max: SIDEBAR.max };
  const sidebar = { mode: sbMode, width: sbWidth, min: first.min, max: first.max, panels };

  const roomRight = C - (sbDocked ? sbWidth + G : 0);
  // a docked pane keeps main at MAIN_MIN: its widest is what is left after main and its gutter
  const paneRoom = roomRight - G - MAIN_MIN;
  const paneMax = Math.min(PANE.max, paneRoom);
  const paneDefaultWidth = paneDefault(roomRight);
  let paneMode: PaneMode = "none";
  let paneWidth = 0;
  let paneLimits: PanelLimits = { min: PANE.min, max: PANE.max };
  if (paneOpen) {
    if (dockable && paneRoom >= PANE.min) {
      paneMode = "docked";
      paneLimits = { min: PANE.min, max: paneMax };
      paneWidth = clamp(savedPane ?? Math.min(paneDefaultWidth, paneMax), PANE.min, paneMax);
    } else {
      // an overlay sheet over main from the right: never wider than the room right of the rail
      paneMode = "overlay";
      const cap = Math.min(PANE.max, C);
      paneLimits = { min: Math.min(PANE.min, cap), max: cap };
      paneWidth = clamp(savedPane ?? paneDefault(C), paneLimits.min, cap);
    }
  }
  const mainWidth = C - (sbDocked ? sbWidth + G : 0) - (paneMode === "docked" ? paneWidth + G : 0);
  return {
    band, gutter: G, rail, sidebar,
    pane: { mode: paneMode, width: paneWidth, defaultWidth: paneMode === "docked" ? Math.min(paneDefaultWidth, paneMax) : paneDefault(C), ...paneLimits },
    main: { width: mainWidth, reading: Math.min(mainWidth, READING_MAX) },
    folded,
  };
}

/** The storage key for a width saved per band: "chats-thread-side@wide". */
export function bandKey(paneKey: string, band: Band): string {
  return `${paneKey}@${band}`;
}
