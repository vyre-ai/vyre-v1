// A slot host: the place that owns a slot (main, side, sidebar, sheet, tab, popover) renders the Kit screens registered for
// it. Screens whose `needs` the viewer lacks are left out, never shown disabled. Single-screen slots show the active one.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { KIT_SLOTS, type KitScreenDef, type KitSlot as Slot, type ScreenPlace } from "../types.ts";
import type { BuiltinRegistry } from "./builtins.ts";
import type { KitEnv } from "./env.ts";
import { KitScreen } from "./KitScreen.tsx";
import type { ScreenRegistry } from "./registry.ts";

/** Slots that stack every registered screen. The others show one at a time. */
export const STACKING_SLOTS: readonly Slot[] = ["side", "sidebar"];

export interface KitSlotProps {
  place: ScreenPlace;
  slot: Slot;
  registry: ScreenRegistry;
  env: KitEnv;
  /** For single-screen slots: the screen to show. Defaults to the first allowed. */
  activeId?: string;
  state?: Readonly<Record<string, unknown>>;
  builtins?: BuiltinRegistry;
}

/** The screens a viewer may see in a slot, in registration order. */
export function screensFor(registry: ScreenRegistry, place: ScreenPlace, slot: Slot, can?: (permission: string) => boolean): KitScreenDef[] {
  return registry.forSlot(place, slot).filter((d) => !can || (d.needs ?? []).every((n) => can(n)));
}

export function KitSlot({ place, slot, registry, env, activeId, state, builtins }: KitSlotProps): ReactElement {
  if (!(KIT_SLOTS as readonly string[]).includes(slot)) throw new Error(`unknown slot ${slot}`);
  const defs = screensFor(registry, place, slot, env.can);
  const shown = STACKING_SLOTS.includes(slot) ? defs : defs.filter((d) => d.id === (activeId ?? defs[0]?.id)).slice(0, 1);
  return (
    <View style={styles.slot} testID={`kit-slot-${place}-${slot}`}>
      {shown.map((d) => <KitScreen key={d.id} def={d} env={env} {...(state ? { state } : {})} {...(builtins ? { builtins } : {})} />)}
    </View>
  );
}

const styles = StyleSheet.create({ slot: { flex: 1 } });
