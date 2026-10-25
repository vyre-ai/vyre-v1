// Builtin component keys ("ui:VaultItem"). Place packets register the real screen behind each key; the runtime renders a
// registered component or, for a key nobody registered yet, an honest "not available" state.
import type { ReactElement } from "react";
import type { KitAction, KitScreenDef } from "../types.ts";
import type { KitEnv } from "./env.ts";
import type { ScreenStatus } from "./queries.ts";
import type { Scope } from "./pointer.ts";

export interface KitScreenContext {
  def: KitScreenDef;
  scope: Scope;
  status: ScreenStatus;
  env: KitEnv;
  /** Runs a named action of the screen against an optional row scope. Confirm and undo follow the def. */
  run(action: string, row?: unknown): void;
  action(name: string): KitAction | undefined;
}

export type BuiltinComponent = (props: { screen: KitScreenContext; props?: Readonly<Record<string, unknown>> }) => ReactElement | null;

export interface BuiltinRegistry {
  register(key: string, component: BuiltinComponent): void;
  resolve(key: string): BuiltinComponent | undefined;
  keys(): string[];
}

export function createBuiltinRegistry(): BuiltinRegistry {
  const map = new Map<string, BuiltinComponent>();
  return {
    register(key, component) {
      if (map.has(key)) throw new Error(`builtin ${key} is already registered`);
      map.set(key, component);
    },
    resolve: (key) => map.get(key),
    keys: () => [...map.keys()].sort(),
  };
}

/** The app-wide registry. Place packets register at module load. */
export const builtins: BuiltinRegistry = createBuiltinRegistry();
