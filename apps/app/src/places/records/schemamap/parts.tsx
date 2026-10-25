// Small pieces shared by the Schema map and the Record types list: the type glyph and the web-only helpers.
import type { ReactElement } from "react";
import { Platform, View } from "react-native";
import type { ViewStyle } from "react-native";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";
import { Glyph } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import { hueOf } from "./model.ts";

export const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
export const sx = (o: Record<string, unknown>): ViewStyle => o as unknown as ViewStyle;

/** The line icon of a record type, as the prototype names them: a person for people, a folder for projects, a page for invoices, a calendar for meetings, a ring for tasks. */
const TYPE_ICON: Readonly<Record<string, IconName>> = {
  clients: "person", client: "person", people: "person", hires: "person", contacts: "person", person: "person",
  projects: "folder", project: "folder", drive: "folder", folder: "folder",
  invoices: "doc", invoice: "doc", files: "doc", documents: "doc",
  meetings: "cal", meeting: "cal", events: "cal", cal: "cal",
  tasks: "task", task: "task",
  messages: "bubble", message: "bubble", threads: "bubble", bubble: "bubble",
};

export const typeIconName = (type: string, icon?: string): IconName => TYPE_ICON[type] ?? (icon !== undefined ? TYPE_ICON[icon] : undefined) ?? "doc";

/**
 * A record type's glyph: the source app's own icon when the type is synced from one, otherwise its line icon on a translucent tile of the type's colour. No letters.
 * The tile reads on every skin and keeps the same colour everywhere.
 */
export function TypeGlyph({ type, icon, syncedFrom, size = 22 }: { type: string; icon?: string | undefined; syncedFrom?: string | undefined; size?: number }): ReactElement {
  if (syncedFrom) return <View aria-hidden testID={`tile-${type}`} style={{ flexShrink: 0 }}><AppIcon brand={syncedFrom} size={size} /></View>;
  const h = hueOf(type);
  return (
    <View aria-hidden testID={`tile-${type}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: `hsla(${h}, 65%, 52%, 0.22)` as string, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Glyph name={typeIconName(type, icon)} size={Math.round(size * 0.58)} color={`hsl(${h}, 55%, 46%)`} width={1.5} />
    </View>
  );
}
