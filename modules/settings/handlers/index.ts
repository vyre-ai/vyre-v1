// Capability handlers for settings (15). One file holds them all: registry.ts.
import { copyProfile, copySource, floorSet, get, kitGet, kitSetMine, kitSetSpace, list, pages, publicOf, reset, resetSpace, searchRows, set, setSpace } from "./registry.ts";

export type { SettingsCtx } from "../projections.ts";

export const handlers = {
  "settings.copy_profile": copyProfile,
  "settings.copy_source": copySource,
  "settings.floor_set": floorSet,
  "settings.get": get,
  "settings.kit.get": kitGet,
  "settings.kit.set_mine": kitSetMine,
  "settings.kit.set_space": kitSetSpace,
  "settings.list": list,
  "settings.public_of": publicOf,
  "settings.pages": pages,
  "settings.reset": reset,
  "settings.reset_space": resetSpace,
  "settings.search": searchRows,
  "settings.set": set,
  "settings.set_space": setSpace,
};
