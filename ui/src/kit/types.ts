// Kit runtime types (ARCH 3.5 KitScreenDef, ARCH 6.8 Block, ARCH 7.11 density).
// The UI carries these so a screen can render without importing the manifest package.

export const DENSITIES = ["regular", "compact"] as const;

export type Density = (typeof DENSITIES)[number];

export type Level = "view" | "use" | "edit" | "manage";

export type CapName = `${string}.${string}`;

export type PermissionKey = string;

export type ComponentKey = string;

export type PlaceId =
  | "home"
  | "chats"
  | "inbox"
  | "records"
  | "files"
  | "apps"
  | "automations"
  | "vault"
  | "settings"
  | "console";

/** PlaceId plus the shell, which a Kit screen may also target. */
export const SCREEN_PLACES = [
  "home",
  "chats",
  "inbox",
  "records",
  "files",
  "apps",
  "automations",
  "vault",
  "settings",
  "console",
  "shell",
] as const;

export type ScreenPlace = (typeof SCREEN_PLACES)[number];

export const KIT_SLOTS = ["main", "side", "sidebar", "sheet", "tab", "popover"] as const;

export type KitSlot = (typeof KIT_SLOTS)[number];

/** JSON value. The manifest compiler owns the TypeBox form. The kit runtime only carries it. */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export type Schema = Json;

export type LayoutNode =
  | { t: "stack" | "row"; gap?: number; children: readonly LayoutNode[] }
  | { t: "list" | "table" | "board"; bind: string; row: LayoutNode; empty?: string }
  | { t: "text"; value: string; style?: string }
  | { t: "field"; bind: string; field: string }
  | { t: "button"; label: string; action: string }
  | { t: "use"; component: ComponentKey; props?: Readonly<Record<string, string>> }
  | { t: "when"; expr: string; then: LayoutNode; else?: LayoutNode };

export interface KitQuery {
  cap: CapName;
  input: Readonly<Record<string, string>>;
  live: boolean;
  local?: "sql";
}

export interface KitAction {
  cap: CapName;
  input: Readonly<Record<string, string>>;
  confirm?: string;
  undo?: boolean;
}

export interface KitStateLine {
  line: string;
  primary?: string;
}

export interface KitScreenDef {
  id: string;
  place: ScreenPlace;
  slot: KitSlot;
  builtin?: ComponentKey;
  layout?: LayoutNode;
  queries: Readonly<Record<string, KitQuery>>;
  actions: Readonly<Record<string, KitAction>>;
  states: {
    empty: KitStateLine;
    offline: KitStateLine;
    error: KitStateLine & { primary: string };
  };
  menus?: readonly {
    target: string;
    items: readonly { label: string; icon: string; action: string; keys?: string; when?: string }[];
  }[];
  keys?: readonly { combo: string; action: string; when?: string }[];
  needs?: readonly PermissionKey[];
  perf?: { firstPaintMs: number; completeMs: number };
  ask?: { suggestions: Partial<Record<Level, readonly string[]>> };
}

export type BlockState = "live" | "done" | "waiting" | "error";

/** A block on a message. The registry key is `${type}@${v}`. */
export interface Block<T = unknown> {
  type: string;
  v: number;
  id: string;
  data: T;
  state?: BlockState;
  traceId: string;
}

export function isKitSlot(value: unknown): value is KitSlot {
  return typeof value === "string" && (KIT_SLOTS as readonly string[]).includes(value);
}

export function isScreenPlace(value: unknown): value is ScreenPlace {
  return typeof value === "string" && (SCREEN_PLACES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasLine(value: unknown): value is { line: string } {
  return isRecord(value) && typeof value.line === "string" && value.line.length > 0;
}

/** Runtime check for a Kit screen before the kit runner mounts it. */
export function isKitScreen(value: unknown): value is KitScreenDef {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (!isScreenPlace(value.place) || !isKitSlot(value.slot)) return false;
  if (!isRecord(value.queries) || !isRecord(value.actions) || !isRecord(value.states)) return false;
  if (!hasLine(value.states.empty) || !hasLine(value.states.offline) || !hasLine(value.states.error)) return false;
  const error = value.states.error;
  return isRecord(error) && typeof error.primary === "string" && error.primary.length > 0;
}
