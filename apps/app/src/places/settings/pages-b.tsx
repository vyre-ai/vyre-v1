// Settings pages that are the same in every Space: Sign-in and devices, Appearance (with Kit choice), Keyboard, This computer, Spaces.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { skins } from "../../../../../ui/src/tokens/skins.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import { Everywhere, Hint, RegistrySections, useRead } from "./blocks.tsx";
import { DEVICES, KIT, useScreenQuery, useSettingsData } from "./data.tsx";
import type { SettingRow } from "./model.ts";
import { useChange } from "./rows.tsx";
import { useSaved } from "./saved.tsx";
import { Choice, Field, Glyph, Mark, Section, SettingsRow, SmallButton, Value, pointer } from "./ui.tsx";
import type { PageProps } from "./pages-a.tsx";

const rowOf = (rows: readonly SettingRow[], key: string): SettingRow | undefined => rows.find((r) => r.key === key);

// ---------------------------------------------------------------- Sign-in and devices

type DevicesOut = CapMap["devices.mine"]["out"];
const CLASS_ICON: Record<string, string> = { desktop: "laptop", phone: "phone", web: "globe", extension: "grid", daemon: "chip" };

export function whenLabel(at: number | undefined, now: number): string {
  if (at === undefined) return "never";
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 2) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

export function SignInPage(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const q = useScreenQuery<DevicesOut>(DEVICES, "mine", {});
  const [sure, setSure] = useState<string | null>(null);
  const now = data.clock().now;
  const fail = (e: unknown): void => saved.failed(e instanceof Error ? e.message : "That did not work.");
  const list: ReactElement[] = [];
  let others = 0;
  if (q.status === "ready") {
    const devices = q.data.devices.filter((d) => d.revokedAt === undefined).sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0));
    devices.forEach((d, i) => {
      if (!d.current) others++;
      const confirming = sure === d.id;
      list.push(
        <SettingsRow
          key={d.id} id={`device.${d.id}`} label={d.name} first={i === 0} lead={<Glyph name={CLASS_ICON[d.class] ?? "laptop"} size={16} />}
          sub={`${d.current ? "This device" : `Last seen ${whenLabel(d.lastSeenAt, now)}`}${d.location ? `, ${d.location}` : ""}`}
          control={
            d.current ? <Value text="This device" /> : confirming ? (
              <>
                <SmallButton label="Cancel" onPress={() => setSure(null)} />
                <SmallButton label="Sign it out" danger testID={`revoke-yes-${d.id}`} onPress={() => void data.call("devices.revoke", { deviceId: d.id }).then(() => { setSure(null); saved.saved("Signed out"); }).catch(fail)} />
              </>
            ) : <SmallButton label="Sign out" testID={`revoke-${d.id}`} onPress={() => setSure(d.id)} />
          }
        />,
      );
    });
  }
  const spaces: ReactElement[] = [];
  data.spaces.forEach((sp, i) => spaces.push(
    <SettingsRow
      key={sp.id} id={`space.${sp.id}`} label={sp.name} first={i === 0} lead={<Mark name={sp.name} />} sub="Its own password, second factor and devices"
      control={<>{sp.current ? <Value text="Open now" /> : <SmallButton label="Open" onPress={() => data.nav.openSpace(sp.id)} />}</>}
    />,
  ));
  return (
    <>
      <Everywhere text="Same in every Space" />
      <Section title="Devices in this Space" note="A signed-out device loses its copy of this Space the next time it connects.">
        {list}
        {others > 0 ? <SettingsRow id="revoke-others" label="Sign out of every other device" danger onPress={() => void data.call("devices.revoke_others", {}).then(() => saved.saved("Signed out of the others")).catch(fail)} control={<Glyph name="chevR" size={13} />} /> : null}
      </Section>
      <Section title="Your Spaces" note="There is no central account. Each Space keeps its own sign-in, so this list is an index.">{spaces}</Section>
    </>
  );
}

// ---------------------------------------------------------------- Appearance

type KitOut = CapMap["settings.kit.get"]["out"];
type KitsOut = CapMap["kits.list"]["out"];

export function AppearancePage({ rows, found }: PageProps): ReactElement {
  const data = useSettingsData();
  const change = useChange();
  const skinRow = rowOf(rows, "appearance.skin");
  const current = typeof skinRow?.value === "string" ? skinRow.value : "classic";
  const kit = useScreenQuery<KitOut>(KIT, "kit", {});
  const kits = useRead<KitsOut>("kits.list");
  const tiles = (group: "dark" | "light"): ReactElement[] => {
    const out: ReactElement[] = [];
    for (const sk of skins) {
      if (sk.base !== group) continue;
      const on = current === sk.id;
      out.push(
        <Pressable
          key={sk.id} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={`${sk.name}. ${sk.note}`} testID={`skin-${sk.id}`}
          onPress={() => { if (skinRow) void change(skinRow, sk.id); }} onHoverIn={() => data.nav.previewSkin?.(sk.id)} onHoverOut={() => data.nav.previewSkin?.(null)}
          style={[a.tile, on && a.tileOn, pointer]}
        >
          <View style={[a.swatch, { backgroundColor: sk.palette.win, borderColor: sk.palette.me }]}>
            <View style={[a.swSide, { backgroundColor: sk.palette.side }]} />
            <View style={[a.swDot, { backgroundColor: sk.palette.accent }]} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={a.tileName}>{sk.name}</Text>
            <Text numberOfLines={1} style={a.tileNote}>{sk.note}</Text>
          </View>
          {on ? <Glyph name="check" size={14} color="var(--accent)" /> : null}
        </Pressable>,
      );
    }
    return out;
  };
  const kitOptions: { value: string; label: string }[] = [{ value: "", label: "Follow the Space" }];
  for (const k of kits?.kits ?? []) if (k.installed) kitOptions.push({ value: k.kitId, label: k.title });
  const kitMine = kit.status === "ready" ? kit.data.kit.person ?? "" : "";
  return (
    <>
      <Everywhere text="Everything here is the same in every Space except the skin" />
      <RegistrySections page="appearance" rows={rows} found={found} />
      {skinRow ? (
        <>
          <Section title="Skin" note="The skin is yours in each Space. Hover a tile to try it; click to keep it.">
            <SettingsRow id="appearance.skin" label="Skin for this Space" first found={found === "appearance.skin"} control={<Value text={skins.find((x) => x.id === current)?.name ?? "System"} />} />
          </Section>
          <Text style={a.group}>Dark</Text>
          <View style={a.grid} testID="skins-dark">{tiles("dark")}</View>
          <Text style={a.group}>Light</Text>
          <View style={a.grid} testID="skins-light">{tiles("light")}</View>
        </>
      ) : null}
      <Section title="Kit" note="A Kit sets the rail, the home page and the words. Pick your own for this Space or follow the Space.">
        <SettingsRow
          id="kit.person_choice" label="Kit" first sub={kit.status === "ready" ? `In effect: ${kits?.kits.find((k) => k.kitId === kit.data.kit.effective)?.title ?? kit.data.kit.effective}` : undefined}
          control={<Choice value={kitMine} options={kitOptions} label="Kit" testID="ctl-kit" onChange={(v) => void data.call("settings.kit.set_mine", { kitId: v === "" ? null : v })} />}
        />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- Keyboard

export const SHORTCUTS: readonly { id: string; label: string; keys: string }[] = [
  { id: "search", label: "Search everything", keys: "Cmd K" },
  { id: "settings-search", label: "Search settings", keys: "Cmd F" },
  { id: "new-chat", label: "New chat", keys: "Cmd N" },
  { id: "ask", label: "Ask the assistant", keys: "Cmd J" },
  { id: "undo", label: "Undo the last change", keys: "Cmd Z" },
  { id: "save", label: "Save", keys: "Cmd S" },
  { id: "close-tab", label: "Close the tab", keys: "Cmd W" },
  { id: "next-tab", label: "Next tab", keys: "Ctrl Tab" },
  { id: "palette", label: "Open the command menu", keys: "Cmd Shift P" },
  { id: "help", label: "Help menu", keys: "Cmd Shift /" },
];

export function KeyboardPage({ rows, found }: PageProps): ReactElement {
  const change = useChange();
  const row = rowOf(rows, "keyboard.overrides");
  const map = (row?.value ?? {}) as Record<string, string>;
  const list: ReactElement[] = [];
  SHORTCUTS.forEach((sc, i) => {
    const mine = map[sc.id];
    const next = (v: string): void => {
      if (!row) return;
      const copy: Record<string, string> = { ...map };
      if (v.trim() === "" || v.trim() === sc.keys) delete copy[sc.id]; else copy[sc.id] = v.trim();
      void change(row, copy);
    };
    list.push(
      <SettingsRow
        key={sc.id} id={`shortcut.${sc.id}`} label={sc.label} {...(mine ? { sub: `Default ${sc.keys}` } : {})}
        control={<>{mine ? <SmallButton label="Reset" onPress={() => next("")} /> : null}<Field value={mine ?? sc.keys} label={`${sc.label} shortcut`} width={130} mono testID={`ctl-shortcut-${sc.id}`} onCommit={next} /></>}
      />,
    );
  });
  return (
    <>
      <Everywhere text="Same in every Space" />
      <Section title="Shortcuts" note="Type the keys you want, for example Cmd Shift K. Clear the field to go back to the default.">
        <SettingsRow
          id="keyboard.overrides" label="Shortcuts" first found={found === "keyboard.overrides"} sub={Object.keys(map).length === 0 ? "All at their defaults" : `${Object.keys(map).length} changed`}
          control={Object.keys(map).length > 0 && row ? <SmallButton label="Reset all" testID="reset-shortcuts" onPress={() => void change(row, {})} /> : undefined}
        />
        {list}
      </Section>
      <RegistrySections page="keyboard" rows={rows} found={found} />
    </>
  );
}

// ---------------------------------------------------------------- This computer and Spaces

export function ComputerPage({ rows, found }: PageProps): ReactElement {
  return (
    <>
      <Everywhere text="Everything here is about this computer, in every Space" />
      <RegistrySections page="computer" rows={rows} found={found} />
      <Hint>Agents work on this computer only as far as you allow here, and a Team Space's agents never run here unless you switch them on for that Space.</Hint>
    </>
  );
}

export function SpacesPage(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const [sure, setSure] = useState<string | null>(null);
  const list: ReactElement[] = [];
  data.spaces.forEach((sp, i) => {
    const leaving = sure === sp.id;
    list.push(
      <SettingsRow
        key={sp.id} id={`space.${sp.id}`} label={sp.name} first={i === 0} lead={<Mark name={sp.name} size={26} />}
        sub={`${sp.addr}, ${sp.role}${sp.needsYou > 0 ? `, ${sp.needsYou} waiting on you` : ""}`}
        control={
          leaving ? (
            <>
              <SmallButton label="Cancel" onPress={() => setSure(null)} />
              <SmallButton label="Leave" danger testID={`leave-yes-${sp.id}`} onPress={() => void data.call("spaces.leave", { confirm: true }).then(() => { setSure(null); saved.saved(`You left ${sp.name}`); }).catch((e: unknown) => saved.failed(e instanceof Error ? e.message : "That did not work."))} />
            </>
          ) : (
            <>
              {sp.current ? <Value text="Open now" /> : <SmallButton label="Open" testID={`open-${sp.id}`} onPress={() => data.nav.openSpace(sp.id)} />}
              {sp.kind === "team" && sp.current ? <SmallButton label="Leave" testID={`leave-${sp.id}`} onPress={() => setSure(sp.id)} /> : null}
            </>
          )
        }
      />,
    );
  });
  return (
    <>
      <Everywhere text="Same in every Space" />
      <Section title="Your Spaces" note={sure ? "Leaving removes this Space from this computer. Your private items there are lost unless you kept a recovery code." : "Join another Space with an invite link from the Join page."}>{list}</Section>
    </>
  );
}

const a = StyleSheet.create({
  group: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string, marginTop: 20, marginBottom: 8, paddingHorizontal: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "31.5%" as unknown as number, minWidth: 180, flexGrow: 1, height: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  tileOn: { borderColor: "var(--accent)" as string, borderWidth: 2 },
  swatch: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, overflow: "hidden" },
  swSide: { position: "absolute", left: 0, top: 0, bottom: 0, width: 11 },
  swDot: { position: "absolute", right: 6, bottom: 6, width: 8, height: 8, borderRadius: 4 },
  tileName: { fontSize: 13.5, color: "var(--ink)" as string },
  tileNote: { fontSize: 12, color: "var(--ink-3)" as string },
});
