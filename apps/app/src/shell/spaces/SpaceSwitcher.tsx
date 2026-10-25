// The Space tile and its menu (spec 2.1, 3.0): the tile sits at the top of the rail with a red dot when another Space needs you; click or right-click opens the
// switcher: your Spaces (the open one checked, a Space that needs you says so), then Add a Space, Invite People, Space Settings, Open Terminal (owner or
// developer), Set Yourself Away, Your Profile and Sign Out. ui/Menu appends Report a problem.
import { useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { menuTrigger, useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { ShellIcon, iconMarkup } from "../rail/icons.tsx";
import { initialOf, othersNeedingYou, tileGradient } from "./model.ts";
import type { SpaceDef } from "./model.ts";

export type SpaceAction = "add" | "invite" | "settings" | "terminal" | "away" | "profile" | "sign-out";

export interface SpaceMenuInput {
  spaces: readonly SpaceDef[];
  openId: string;
  away: boolean;
  onSwitch: (spaceId: string) => void;
  onAction: (action: SpaceAction) => void;
}

/** The menu's entries. Pure, so the content is tested without a window. Every item has an icon (icons are all or none, D51). */
export function spaceMenuEntries(input: SpaceMenuInput): MenuEntry[] {
  const open = input.spaces.find((s) => s.spaceId === input.openId);
  const dot = '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="3.5" fill="currentColor"/></svg>';
  const out: MenuEntry[] = [{ head: "Spaces" }];
  input.spaces.forEach((s) => {
    const hint = s.spaceId === input.openId ? "" : s.needsYou ? ", needs you" : "";
    out.push({
      label: `${s.name}${hint}`,
      icon: s.kind === "personal" ? iconMarkup("user") : dot,
      checked: s.spaceId === input.openId,
      onSelect: () => input.onSwitch(s.spaceId),
    });
  });
  out.push({ separator: true });
  out.push({ label: "Add a Space", icon: iconMarkup("join"), onSelect: () => input.onAction("add") });
  out.push({ label: "Invite People", icon: iconMarkup("userPlus"), onSelect: () => input.onAction("invite") });
  out.push({ label: "Space Settings", icon: iconMarkup("settings"), onSelect: () => input.onAction("settings") });
  if (open !== undefined && open.terminal) out.push({ label: "Open Terminal", icon: iconMarkup("terminal"), onSelect: () => input.onAction("terminal") });
  out.push({ separator: true });
  out.push({ label: input.away ? "I'm Back" : "Set Yourself Away", icon: iconMarkup(input.away ? "check" : "moon"), onSelect: () => input.onAction("away") });
  out.push({ label: "Your Profile", icon: iconMarkup("user"), onSelect: () => input.onAction("profile") });
  out.push({ label: "Sign Out", icon: iconMarkup("signOut"), onSelect: () => input.onAction("sign-out") });
  return out;
}

export type SpaceTileProps = SpaceMenuInput;

export function SpaceTile(props: SpaceTileProps): ReactElement {
  const { spaces, openId, away } = props;
  const open = spaces.find((s) => s.spaceId === openId) ?? spaces[0];
  const { element, show } = useMenu();
  const [over, setOver] = useState(false);
  if (open === undefined) return <View />;
  const red = othersNeedingYou(spaces, openId).length > 0;
  const web = Platform.OS === "web" ? { title: `${open.name}, ${open.address}` } : {};
  const at = (x: number, y: number): void => show(spaceMenuEntries(props), x, y, "other", { label: open.name });
  return (
    <View style={styles.wrap}>
      <Pressable
        role="button"
        aria-label={`Space: ${open.name}${red ? ", another Space needs you" : ""}`}
        testID="space-tile"
        onPress={(e) => {
          const ev = e as unknown as { currentTarget?: { getBoundingClientRect?: () => { right: number; top: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
          const box = ev.currentTarget?.getBoundingClientRect?.();
          at(box ? box.right + 8 : ev.nativeEvent?.pageX ?? 0, box ? box.top : ev.nativeEvent?.pageY ?? 0);
        }}
        onHoverIn={() => setOver(true)}
        onHoverOut={() => setOver(false)}
        {...menuTrigger(at)}
        {...web}
        style={[styles.tile, { opacity: over ? 0.92 : 1 }, tintStyle(open)]}
      >
        <Text style={styles.letter}>{initialOf(open)}</Text>
        {away ? <View testID="tile-away" style={styles.away}><ShellIcon name="moon" size={9} color="#fff" /></View> : null}
        {red ? <View testID="tile-dot" accessibilityLabel="Another Space needs you" style={styles.dot} /> : null}
      </Pressable>
      {element}
    </View>
  );
}

/** A gradient is a web-only style; native falls back to the first colour. */
function tintStyle(def: SpaceDef): ViewStyle {
  return (Platform.OS === "web" ? { backgroundImage: tileGradient(def) } : { backgroundColor: def.tint[0] }) as ViewStyle;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  tile: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  letter: { color: "#fff", fontSize: 14, fontWeight: "700" },
  dot: { position: "absolute", top: -2, right: -2, width: 9, height: 9, borderRadius: 5, backgroundColor: "var(--danger)" as string, borderWidth: 2, borderColor: "var(--rail)" as string },
  away: { position: "absolute", right: -3, bottom: -3, width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "var(--warn)" as string, borderWidth: 2, borderColor: "var(--rail)" as string },
});
