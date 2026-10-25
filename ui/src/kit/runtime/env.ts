// What a Kit screen needs from its host. The app shell supplies it; tests supply a fake. Nothing here imports a module.
import type { KitAction } from "../types.ts";
import type { ScreenHooks } from "../../../../client/src/index.ts";

export interface MenuItem {
  label: string;
  icon: string;
  action: string;
  keys?: string;
}

export interface MenuRequest {
  target: string;
  items: readonly MenuItem[];
  point: { x: number; y: number };
  /** Runs one of the items against the row it was opened on. */
  run(action: string): void;
}

export interface KitEnv {
  /** Typed live query hooks over the local replica (client createScreenHooks). */
  hooks: ScreenHooks;
  online: boolean;
  /** One-shot server read for a query marked `live: false`. Missing means such a query errors, never hangs. */
  read?(cap: string, input: Record<string, unknown>): Promise<unknown>;
  /** Runs an action's capability. The runtime has already resolved the input and asked for confirmation. */
  invoke(action: KitAction, input: Record<string, unknown>): Promise<unknown> | void;
  /** Resolves true when the person confirms. Missing means the action runs without asking. */
  confirm?(text: string): Promise<boolean>;
  /** Permission check for `needs`. Missing means everything is allowed (tests). */
  can?(permission: string): boolean;
  /**
   * Props to spread on a container so right-click, the menu key and Shift+F10 reach the host's menu. The shell passes the
   * ui/Menu trigger here; the runtime never listens for the native event itself (lint no-raw-context-menu).
   */
  menuTrigger?(open: (x: number, y: number) => void): Record<string, unknown>;
  /** Shows the menu for a row. The shell builds it with ui/Menu, which appends Report a problem. */
  openMenu?(request: MenuRequest): void;
  /** Screen-level retry after an error, beyond the runtime re-reading its queries. */
  retry?(screenId: string): void;
  /** Id shown on the error state so the person can quote it. */
  traceId?: string;
}
