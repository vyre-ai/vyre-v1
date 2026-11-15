// The New tab keeps the shell's one sidebar column like every other place (owner walk, 15 Nov 2026: the frame never moves): the places, one row each. A row opens that place in this tab.
import type { ReactElement } from "react";
import { View } from "react-native";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { MenuIcon } from "../../../../../ui/src/Menu/index.tsx";
import { SidebarContent } from "../sidebar/index.ts";
import { iconMarkup } from "../rail/icons.tsx";
import type { PlaceId, RailEntry } from "../rail/kits.ts";

export function NewTabSidebar({
  places,
  onGo,
}: {
  places: readonly RailEntry[];
  onGo(place: PlaceId): void;
}): ReactElement {
  return (
    <SidebarContent title="New tab" noSearch>
      {() => (
        <View testID="newtab-places" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          {places.map((p) => (
            <Row
              key={p.place}
              id={`newtab:${p.place}`}
              title={p.title}
              leading={
                <View style={{ width: 26, alignItems: "flex-start", justifyContent: "center" }}>
                  <MenuIcon icon={iconMarkup(p.place)} color="var(--ink-2)" />
                </View>
              }
              onPress={() => onGo(p.place)}
            />
          ))}
        </View>
      )}
    </SidebarContent>
  );
}
