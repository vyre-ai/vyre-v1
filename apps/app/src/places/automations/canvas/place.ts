// The Automations place frame: sidebar plus canvas, painted with a Space skin.
// Northwind uses Paper, the default light skin. Harbor Studio uses Linen so the
// two seeded Team Spaces do not share a skin. Width 390 is compact. Width 1280
// is regular. Tokens come from ui/src/tokens/skins.ts before first paint.

import { nativeTokens, skinById } from "../../../../../../ui/src/tokens/skins.ts";
import type { TokenSet } from "../../../../../../ui/src/tokens/skins.ts";
import type { Editor } from "./model.ts";
import { renderCanvas } from "./render.ts";
import type { SidebarModel } from "../sidebar/model.ts";
import { renderSidebar } from "../sidebar/render.ts";

export const SPACE_SKIN = {
  Northwind: "paper",
  "Harbor Studio": "linen",
} as const;

export type CanvasSpace = keyof typeof SPACE_SKIN;
export const FRAME_WIDTHS = [1280, 390] as const;
export type FrameWidth = (typeof FRAME_WIDTHS)[number];

export interface PlaceFrame {
  space: CanvasSpace;
  width: FrameWidth;
  editor: Editor;
  sidebar: SidebarModel;
}

function tokenStyle(tokens: TokenSet): string {
  return Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(";");
}

/** Presentation only. Attribute hooks stay on the markup the screen test reads. */
const FRAME_CSS = [
  "[data-place=automations]{box-sizing:border-box}",
  "[data-place=automations] *{box-sizing:border-box}",
  "[data-place=automations] header{margin:0;padding:10px 16px;font-weight:600;border-bottom:1px solid var(--line)}",
  "[data-slot=sidebar]{background:var(--side);padding:12px}",
  "[data-slot=tab]{padding:12px 16px}",
  "[data-layout=columns] [data-slot=sidebar]{border-right:1px solid var(--line)}",
  "[data-layout=stack] [data-slot=sidebar]{border-bottom:1px solid var(--line)}",
  "[role=tab]{display:inline-block;margin:0 4px 8px 0;padding:6px 10px;border-radius:6px}",
  "[role=tab][aria-selected=true]{background:var(--accent);color:var(--accent-ink)}",
  "[data-groups] h3,[data-section] h2,h3{margin:8px 0 4px;font-size:13px;font-weight:600}",
  "[data-placeholder=Row],[data-row]{display:block;width:100%;padding:6px 0;border-bottom:1px solid var(--line)}",
  "[data-placeholder=Row][data-selected=true]{background:var(--sel)}",
  "[data-note]{display:block;color:var(--ink-3);font-size:12px}",
  "[data-trigger]{display:inline-block;margin:4px 0;padding:4px 8px;border:1px solid var(--accent-line);border-radius:999px;background:var(--accent-wash)}",
  "[data-palette=controls]{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}",
  "button{font:inherit;color:var(--ink);background:var(--raised);border:1px solid var(--line);border-radius:6px;padding:6px 10px}",
  "[data-node]{margin:8px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--raised)}",
  "[data-lane=lit]{border-color:var(--accent);outline:2px solid var(--accent)}",
  "[data-lane=dim]{opacity:.45}",
  "[data-branches]{display:flex;gap:8px;align-items:stretch}",
  "[data-layout=stack] [data-branches]{flex-direction:column}",
  "[data-branch]{flex:1;min-width:0;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--sunk)}",
  "[data-branch][data-branch-lane=lit]{border-color:var(--accent)}",
  "[data-issue],p[role=alert]{color:var(--danger)}",
  "p[role=alert]{margin:4px 0;font-size:13px}",
].join("");

/** Both columns at 1280. Stacked at 390. Sizes are reserved so the frame does not shift. */
export function renderAutomationsPlace(frame: PlaceFrame): string {
  const skinId = SPACE_SKIN[frame.space];
  const skin = skinById(skinId);
  if (!skin) throw new Error("Unknown skin");
  const tokens = nativeTokens(skin);
  const density = frame.width <= 480 ? "compact" : "regular";
  const stacked = frame.width <= 480;
  const layout = stacked ? "stack" : "columns";
  const sideWidth = stacked ? "100%" : "280px";
  const minHeight = stacked ? "844px" : "640px";
  const style = `width:${frame.width}px;min-height:${minHeight};${tokenStyle(tokens)};color:var(--ink);background:var(--win);font-family:Inter,ui-sans-serif,system-ui,sans-serif`;
  const sidebar = renderSidebar(frame.sidebar);
  const canvas = renderCanvas(frame.editor, { width: frame.width });
  return `<div data-place="automations" data-space="${frame.space}" data-skin="${skin.id}" data-skin-name="${skin.name}" data-mode="${skin.base}" data-width="${frame.width}" data-density="${density}" data-layout="${layout}" data-layout-shift="0" style="${style}"><style>${FRAME_CSS}</style><header>Vyre · ${frame.space}</header><div data-layout="${layout}" style="display:flex;flex-direction:${stacked ? "column" : "row"}"><div data-slot="sidebar" style="width:${sideWidth};min-height:160px">${sidebar}</div><div data-slot="tab" style="flex:1;min-width:0;min-height:320px">${canvas}</div></div></div>`;
}

export function renderShotDocument(frame: PlaceFrame): string {
  const body = renderAutomationsPlace(frame);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Automations canvas</title></head><body style="margin:0">${body}</body></html>`;
}
