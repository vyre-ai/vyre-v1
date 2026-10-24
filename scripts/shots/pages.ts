// Screen pages for shots. String markup on react-native-web, themed by a place skin.
// batch1 is the frozen props page (P-PR_51). screens is the batch3 screen page.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type { ComposerShellProps } from "../../ui/src/Composer/props.ts";
import { defaultDensity, heightFor, placeSkin, type Density } from "./skins.ts";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) {
      return { format: "module-typescript", source: readFileSync(fileURLToPath(url)), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

export const SCREEN_IDS = ["batch1", "screens"] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

/** Sample arguments for the composer on the batch1 page. */
export const batch1ComposerSample: ComposerShellProps = {
  whoWillAnswer: "Ada will answer",
  sendsOutside: true,
  chips: [{ kind: "agent", name: "Ada" }],
};

export function knownScreen(id: string): ScreenId {
  if (id === "batch1" || id === "screens") return id;
  throw new Error(`Unknown screen id: ${id}`);
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function cssVars(tokens: Record<string, string>): string {
  return Object.entries(tokens).map(([key, value]) => `${key}:${value}`).join(";");
}

async function batch1Body(): Promise<string> {
  const { ComposerPlaceholder } = await import("../../ui/src/Composer/Placeholder.tsx");
  const { ListSectionsPlaceholder } = await import("../../ui/src/ListSections/Placeholder.tsx");
  const { MenuPlaceholder } = await import("../../ui/src/Menu/Placeholder.tsx");
  const { RecipientsPlaceholder } = await import("../../ui/src/Recipients/Placeholder.tsx");
  const { RowPlaceholder } = await import("../../ui/src/Row/Placeholder.tsx");
  const { SidePanePlaceholder } = await import("../../ui/src/SidePane/Placeholder.tsx");
  const { StatesPlaceholder } = await import("../../ui/src/States/Placeholder.tsx");
  const { TabStripPlaceholder } = await import("../../ui/src/TabStrip/Placeholder.tsx");
  const { VirtualListPlaceholder } = await import("../../ui/src/VirtualList/Placeholder.tsx");
  const parts = [
    VirtualListPlaceholder({ data: [{ title: "Inbox" }, { title: "Sent" }, { title: "Drafts" }], renderItem: () => null, rowHeight: 32 }),
    MenuPlaceholder({ items: [{ label: "Open" }, { label: "Rename" }, { label: "Delete", danger: true }] }),
    TabStripPlaceholder({ tabs: [{ key: "a", title: "Chat" }, { key: "b", title: "Files" }], active: "b", onPlus: () => {}, plusTitle: "New tab" }),
    SidePanePlaceholder({ toggle: { open: false }, paneKey: "ask", title: "Ask", tabs: [{ key: "x", title: "Info" }, { key: "y", title: "Activity" }], activeTab: "x" }),
    RowPlaceholder({ id: "r1", title: "Acme Law", note: "Open matter", selected: true }),
    StatesPlaceholder({ kind: "empty", title: "No files yet", icon: "files", action: { label: "Add a file", onPress: () => {} } }),
    StatesPlaceholder({ kind: "error", message: "Could not save", cause: "Disk full", next: "Free space and retry", retryable: true, traceId: "t-1" }),
    ComposerPlaceholder(batch1ComposerSample),
    RecipientsPlaceholder({ to: [{ email: "a@x.com", name: "Ann" }], cc: ["b@x.com"] }),
    ListSectionsPlaceholder({ type: "forms", sections: [{ name: "Personal", rows: [{ id: "1", title: "Intake" }] }, { name: "Space", rows: [{ id: "2", title: "Referral", note: "3" }] }] }),
  ];
  return `<main data-screen="batch1" data-screen-id="batch1">${parts.join("")}</main>`;
}

async function screensBody(): Promise<string> {
  const { renderScreen } = await import("../../ui/src/__screens__/index.tsx");
  return renderScreen();
}

export interface PageOpts {
  screenId: string;
  skin: string;
  width: number;
  height?: number;
  density?: Density;
}

/** HTML document for one screen, one place skin, one viewport. */
export async function renderScreenPage(opts: PageOpts): Promise<string> {
  const screenId = knownScreen(opts.screenId);
  const place = placeSkin(opts.skin);
  const density = opts.density ?? defaultDensity(opts.width);
  const height = opts.height ?? heightFor(opts.width);
  const inner = screenId === "batch1" ? await batch1Body() : await screensBody();
  const vars = cssVars(place.tokens);
  const width = String(opts.width);
  return `<!doctype html><html data-runtime="react-native-web" data-width="${width}" data-height="${height}" data-density="${density}" data-space="${esc(place.space)}" data-skin-id="${esc(place.skinId)}" data-screen-id="${esc(screenId)}"><head><meta charset="utf-8"><meta name="viewport" content="width=${width}"><style>:root{${vars}}html,body{margin:0;width:${width}px;background:var(--win);color:var(--ink);font-family:var(--ui),system-ui,sans-serif}body{font-size:${density === "compact" ? 12 : 14}px}[data-rn="View"]{display:flex;flex-direction:column;width:100%}</style></head><body data-runtime="react-native-web" data-width="${width}" data-density="${density}"><div data-rn="View" data-runtime="react-native-web" data-width="${width}">${inner}</div></body></html>`;
}
