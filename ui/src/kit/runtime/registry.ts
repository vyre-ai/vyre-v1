// Screens index: the Kit screens a build knows, by id and by place plus slot. Modules register their KitScreenDefs at boot
// (ARCH 3.5, 9: manifest screens[]). The generated screen index (generated/screens.ts) is the contract; `diffAgainst` says
// which of its ids have no def yet and which defs are not in the contract.
import { isKitScreen, type KitScreenDef, type KitSlot, type ScreenPlace } from "../types.ts";

export interface ScreenRegistry {
  register(def: KitScreenDef): void;
  get(id: string): KitScreenDef | undefined;
  all(): readonly KitScreenDef[];
  /** Screens for a place and slot, in registration order. */
  forSlot(place: ScreenPlace, slot: KitSlot): readonly KitScreenDef[];
  diffAgainst(contractIds: Iterable<string>): { missing: string[]; extra: string[] };
}

export function createScreenRegistry(defs: Iterable<KitScreenDef> = []): ScreenRegistry {
  const byId = new Map<string, KitScreenDef>();
  const registry: ScreenRegistry = {
    register(def) {
      if (!isKitScreen(def)) throw new Error(`not a Kit screen: ${(def as { id?: unknown } | null)?.id ?? "unknown"}`);
      if (byId.has(def.id)) throw new Error(`screen ${def.id} is already registered`);
      byId.set(def.id, def);
    },
    get: (id) => byId.get(id),
    all: () => [...byId.values()],
    forSlot: (place, slot) => [...byId.values()].filter((d) => d.place === place && d.slot === slot),
    diffAgainst(contractIds) {
      const contract = new Set(contractIds);
      return {
        missing: [...contract].filter((id) => !byId.has(id)).sort(),
        extra: [...byId.keys()].filter((id) => !contract.has(id)).sort(),
      };
    },
  };
  for (const def of defs) registry.register(def);
  return registry;
}
