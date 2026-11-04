// Wraps the Settings place's call so that saving one of the Appearance settings (text size, density, language, reduce motion) changes the window the moment it is saved, and keeps it for the next start.
import { applyIfAppearance, restoreAppearance, APPEARANCE_SETTING_KEYS } from "../appearance.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

export function appearanceAware(call: Call, personId: string): Call {
  let current = restoreAppearance(personId);
  return async (cap, input) => {
    const out = await call(cap, input);
    if (cap === "settings.set" || cap === "settings.reset") {
      const i = input as { key?: string; value?: unknown };
      if (typeof i.key === "string" && APPEARANCE_SETTING_KEYS.includes(i.key)) {
        const value = cap === "settings.reset" ? (out as { row?: { value?: unknown } } | null)?.row?.value : i.value;
        current = applyIfAppearance(personId, i.key, current, value);
      }
    }
    return out;
  };
}
