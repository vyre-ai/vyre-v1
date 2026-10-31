// Which app's logo a step wears, from its kind and, for a connector someone built, the connector's name. Null means the step is a Vyre step and draws its own glyph.
import { brandForName } from "../../../../../../ui/src/AppIcon/index.tsx";

const BY_PREFIX: readonly (readonly [string, string])[] = [
  ["google.gmail.", "gmail"], ["google.calendar.", "gcal"], ["google.drive.", "gdrive"], ["google.sheets.", "google"], ["google.docs.", "googledocs"], ["sheet.", "google"],
  ["ms.mail.", "microsoft"], ["ms.calendar.", "microsoft"], ["ms.drive.", "microsoftonedrive"], ["ms.", "microsoft"],
  ["github.", "github"],
];

export function brandForStep(key: string, input?: Readonly<Record<string, unknown>>): string | null {
  if (key === "connector_request") {
    const c = typeof input?.["connector"] === "string" ? input["connector"] : "";
    return c === "" ? null : brandForName(c) ?? c;
  }
  for (const [prefix, brand] of BY_PREFIX) if (key.startsWith(prefix)) return brand;
  return null;
}
