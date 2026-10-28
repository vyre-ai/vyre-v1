// Settings pages that are the same in every Space: Sign-in and devices, Appearance (with Kit choice), Keyboard, This computer, Spaces.
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { skins, system } from "../../../../../ui/src/tokens/skins.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import { Everywhere, RegistrySections, useRead } from "./blocks.tsx";
import { DEVICES, KIT, useScreenQuery, useSettingsData } from "./data.tsx";
import type { SettingsData, SpaceSecurity, SpaceTile } from "./data.tsx";
import type { SettingRow } from "./model.ts";
import { useChange } from "./rows.tsx";
import { useSaved } from "./saved.tsx";
import { Choice, Field, Glyph, Mark, Section, SettingsRow, SmallButton, Value, pointer, webOnly } from "./ui.tsx";
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
  const sec = data.security;
  const cards: ReactElement[] = [];
  if (sec) for (const sp of data.spaces) { const info = sec.spaces[sp.id]; if (info) cards.push(<SpaceSecurityCard key={sp.id} space={sp} info={info} />); }
  return (
    <>
      <Everywhere text="Same in every Space" />
      {sec ? <AccountCard sec={sec} /> : <Section title="Sign-in"><SettingsRow id="signin.password" label="Password" first control={<SmallButton label="Change..." testID="pw-change" onPress={() => data.nav.manageSecurity?.("password", data.space.id)} />} /><SettingsRow id="signin.authenticator" label="Authenticator app" sub="Set up or remove a second factor for this Space" control={<><SmallButton label="Set up" testID="totp-setup" onPress={() => data.nav.manageSecurity?.("totp-on", data.space.id)} /><SmallButton label="Remove" testID="totp-remove" onPress={() => data.nav.manageSecurity?.("totp-off", data.space.id)} /></>} /></Section>}
      {cards}
      <Section title="Devices and computers">
        {list}
        {others > 0 ? <SettingsRow id="revoke-others" label="Sign out of every other device" danger onPress={() => void data.call("devices.revoke_others", {}).then(() => saved.saved("Signed out of the others")).catch(fail)} control={<Glyph name="chevR" size={13} />} /> : null}
      </Section>
    </>
  );
}

function AccountCard({ sec }: { sec: NonNullable<SettingsData["security"]> }): ReactElement {
  const data = useSettingsData();
  const gh = sec.account.github;
  const first = data.spaces.find((sp) => sp.current)?.id ?? data.space.id;
  return (
    <Section title="Sign-in" testID="signin-account">
      <SettingsRow id="signin.password" label="Password" first lead={<Glyph name="key" size={16} />} sub={`Changed ${sec.account.passwordChanged}`} control={<SmallButton label="Change..." testID="pw-change" onPress={() => data.nav.manageSecurity?.("password", first)} />} />
      <SettingsRow
        id="signin.github" label="GitHub" lead={<Glyph name="github" size={16} />} sub={gh ? `Connected as @${gh}` : "Sign in with one click"}
        control={<SmallButton label={gh ? "Disconnect" : "Connect"} testID="gh-toggle" onPress={() => data.nav.manageSecurity?.(gh ? "github-off" : "github-on", first)} />}
      />
    </Section>
  );
}

/** One Space's own sign-in: authenticator app, passkeys, the second factor its admins require, single sign-on and how many devices are in it. */
function SpaceSecurityCard({ space, info }: { space: SpaceTile; info: SpaceSecurity }): ReactElement {
  const data = useSettingsData();
  const team = space.kind === "team";
  return (
    <View style={s2.card} testID={`security-${space.id}`}>
      <View style={s2.head}>
        <Text accessibilityRole="header" style={s2.title}>{space.name}</Text>
        {space.current ? <Text style={s2.open}>Open now</Text> : <SmallButton label="Open" testID={`open-${space.id}`} onPress={() => data.nav.openSpace(space.id)} />}
      </View>
      <View style={a.cardBox}>
        <SettingsRow
          id={`signin.totp.${space.id}`} label="Authenticator app" first sub={info.totp ? "One-time codes on your phone" : "Not set up"}
          control={<SmallButton label={info.totp ? "Remove" : "Set up"} testID={`totp-${space.id}`} onPress={() => data.nav.manageSecurity?.(info.totp ? "totp-off" : "totp-on", space.id)} />}
        />
        <SettingsRow
          id={`signin.passkey.${space.id}`} label="Passkeys" sub={info.passkeys.length > 0 ? info.passkeys.join(", ") : "None yet"}
          control={<SmallButton label="Add a passkey" testID={`passkey-${space.id}`} onPress={() => data.nav.manageSecurity?.("passkey", space.id)} />}
        />
        {team ? <SettingsRow id={`signin.floor.${space.id}`} label="Second factor required" sub={`Set by ${info.floorBy}`} control={<Value text={info.floor} />} /> : null}
        {team ? <SettingsRow id={`signin.sso.${space.id}`} label="Single sign-on" sub={info.sso ? `Your admin signs you in with ${info.sso}` : "This Space uses its own password"} control={<Value text={info.sso ? "On" : "Off"} />} /> : null}
        <SettingsRow id={`signin.devs.${space.id}`} label="Devices" sub={team ? `Signed in on ${info.devices} ${info.devices === 1 ? "device" : "devices"}` : "This computer only"} control={<Value text={String(info.devices)} />} />
      </View>
    </View>
  );
}

const s2 = StyleSheet.create({
  card: { marginTop: 26 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 2, minHeight: 28 },
  title: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  open: { fontSize: 12.5, color: "var(--ink-3)" as string },
});

// ---------------------------------------------------------------- Appearance

type KitOut = CapMap["settings.kit.get"]["out"];
type KitsOut = CapMap["kits.list"]["out"];

/** The little window above the tiles: the skin you hover (or the one you have) drawn with its own palette, so a tile is tried before it is kept. */
function documentMode(): "dark" | "light" | null {
  const root = (globalThis as { document?: { documentElement?: { getAttribute(n: string): string | null } } }).document?.documentElement;
  const m = root?.getAttribute("data-mode") ?? null;
  return m === "dark" || m === "light" ? m : null;
}
const noWatch = (): (() => void) => () => undefined;

/** System shows the skin the computer is on: Graphite in the dark, Paper in the light. The server snapshot is "unmarked", so a pre-rendered page hydrates and then follows the document. */
function SkinPreview({ skinId, space }: { skinId: string; space: string }): ReactElement {
  const ambient = useSyncExternalStore(noWatch, documentMode, () => null);
  const shown = skinId === "system" ? (ambient === "dark" ? "graphite" : "paper") : skinId;
  const sk = skins.find((x) => x.id === shown) ?? skins.find((x) => x.id === "paper")!;
  const p = sk.palette;
  const navItems: ReactElement[] = [];
  for (const n of ["Home", "Chats", "Projects", "Files"]) navItems.push(<View key={n} style={[a.pvItem, n === "Chats" && { backgroundColor: p.me }]}><Text style={[a.pvItemText, { color: n === "Chats" ? p.ink : p.ink2 }]}>{n}</Text></View>);
  return (
    <View style={a.pvStage} testID="skin-preview" accessibilityLabel={`Preview of ${sk.name}`}>
      <View style={[a.pvWin, { backgroundColor: p.win, borderColor: p.me }]}>
        <View style={[a.pvSide, { backgroundColor: p.side }]}>
          <View style={a.pvSpace}><View style={[a.pvDot, { backgroundColor: p.accent }]} /><Text numberOfLines={1} style={[a.pvSpaceText, { color: p.ink }]}>{space}</Text></View>
          {navItems}
        </View>
        <View style={a.pvMain}>
          <Text style={[a.pvTitle, { color: p.ink }]}>Weekly report</Text>
          <View style={[a.pvMsg, { backgroundColor: p.me, alignSelf: "flex-end" }]}><Text style={[a.pvMsgText, { color: p.ink }]}>Can you pull this week's numbers?</Text></View>
          <Text style={[a.pvMsgText, { color: p.ink2, marginTop: 8 }]}>Done. Four new customers, two renewals.</Text>
          <View style={a.pvBar}>
            <View style={[a.pvField, { backgroundColor: p.raised, borderColor: p.me }]} />
            <View style={[a.pvSend, { backgroundColor: p.accent }]}><Text style={a.pvSendText}>Send</Text></View>
          </View>
        </View>
      </View>
    </View>
  );
}

export function AppearancePage({ rows, found }: PageProps): ReactElement {
  const data = useSettingsData();
  const change = useChange();
  const skinRow = rowOf(rows, "appearance.skin");
  const stored = typeof skinRow?.value === "string" ? skinRow.value : "system";
  const current = stored === "system" || skins.some((x) => x.id === stored) ? stored : "system";
  const [hover, setHover] = useState<string | null>(null);
  const kit = useScreenQuery<KitOut>(KIT, "kit", {});
  const kits = useRead<KitsOut>("kits.list");
  const tile = (id: string, name: string, note: string, swatch: ReactElement): ReactElement => {
    const on = current === id;
    return (
      <Pressable
        key={id} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={`${name}. ${note}`} testID={`skin-${id}`}
        onPress={() => { if (skinRow) void change(skinRow, id); }}
        onHoverIn={() => { setHover(id); data.nav.previewSkin?.(id); }} onHoverOut={() => { setHover(null); data.nav.previewSkin?.(null); }}
        style={[a.tile, on && a.tileOn, pointer]}
      >
        {swatch}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={a.tileName}>{name}</Text>
          <Text numberOfLines={1} style={a.tileNote}>{note}</Text>
        </View>
        {on ? <Glyph name="check" size={14} color="var(--accent)" /> : null}
      </Pressable>
    );
  };
  const tiles = (group: "dark" | "light"): ReactElement[] => {
    const out: ReactElement[] = [];
    for (const sk of skins) {
      if (sk.base !== group) continue;
      out.push(tile(sk.id, sk.name, sk.note, (
        <View style={[a.swatch, { backgroundColor: sk.palette.win, borderColor: sk.palette.me }]}>
          <View style={[a.swSide, { backgroundColor: sk.palette.side }]} />
          <View style={[a.swDot, { backgroundColor: sk.palette.accent }]} />
        </View>
      )));
    }
    return out;
  };
  const paper = skins.find((x) => x.id === "paper")!;
  const graphite = skins.find((x) => x.id === "graphite")!;
  const systemSwatch = (
    <View style={[a.swatch, { flexDirection: "row", borderColor: paper.palette.me }]}>
      <View style={{ flex: 1, backgroundColor: paper.palette.win }} /><View style={{ flex: 1, backgroundColor: graphite.palette.win }} />
    </View>
  );
  const kitOptions: { value: string; label: string }[] = [{ value: "", label: "Follow the Space" }];
  for (const k of kits?.kits ?? []) if (k.installed) kitOptions.push({ value: k.kitId, label: k.title });
  const kitMine = kit.status === "ready" ? kit.data.kit.person ?? "" : "";
  const shown = hover ?? current;
  return (
    <>
      <Everywhere text="Everything here is the same in every Space except the skin" />
      <RegistrySections page="appearance" rows={rows} found={found} />
      {skinRow ? (
        <View testID="row-appearance.skin" {...webOnly({ dataSet: { sid: "appearance.skin" } })} style={found === "appearance.skin" ? a.foundBlock : undefined}>
          <Text accessibilityRole="header" style={a.heading}>Skin</Text>
          <SkinPreview skinId={shown} space={data.space.name} />
          <Text style={a.group}>System</Text>
          <View style={a.grid} testID="skins-system">{tile("system", system.name, system.note, systemSwatch)}</View>
          <Text style={a.group}>Dark</Text>
          <View style={a.grid} testID="skins-dark">{tiles("dark")}</View>
          <Text style={a.group}>Light</Text>
          <View style={a.grid} testID="skins-light">{tiles("light")}</View>
          <Text style={a.foot} testID="skin-foot">{`Just for you, in ${data.space.name}`}</Text>
        </View>
      ) : null}
      <Section title="Kit">
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
      <Section title="Shortcuts">
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
      <Section title="Your Spaces" {...(sure ? { note: "Leaving removes this Space from this computer. Your private items there are lost unless you kept a recovery code." } : {})}>{list}</Section>
    </>
  );
}

const a = StyleSheet.create({
  group: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string, marginTop: 20, marginBottom: 8, paddingHorizontal: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "31.5%" as unknown as number, minWidth: 180, flexGrow: 1, height: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  cardBox: { borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  tileOn: { borderColor: "var(--accent)" as string, borderWidth: 2 },
  swatch: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, overflow: "hidden" },
  swSide: { position: "absolute", left: 0, top: 0, bottom: 0, width: 11 },
  swDot: { position: "absolute", right: 6, bottom: 6, width: 8, height: 8, borderRadius: 4 },
  tileName: { fontSize: 13.5, color: "var(--ink)" as string },
  tileNote: { fontSize: 12, color: "var(--ink-3)" as string },
  foundBlock: { backgroundColor: "var(--accent-wash)" as string, borderRadius: 12 },
  heading: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string, marginTop: 26, marginBottom: 8, paddingHorizontal: 2 },
  foot: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 14, paddingHorizontal: 2 },
  pvStage: { borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, paddingVertical: 20, alignItems: "center" },
  pvWin: { width: "78%" as unknown as number, maxWidth: 400, height: 150, flexDirection: "row", borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  pvSide: { width: "28%" as unknown as number, padding: 8, gap: 2 },
  pvSpace: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  pvDot: { width: 9, height: 9, borderRadius: 3 },
  pvSpaceText: { fontSize: 9.5, fontWeight: "600", flexShrink: 1 },
  pvItem: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  pvItemText: { fontSize: 9 },
  pvMain: { flex: 1, padding: 10 },
  pvTitle: { fontSize: 10, fontWeight: "600", marginBottom: 8 },
  pvMsg: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  pvMsgText: { fontSize: 9 },
  pvBar: { position: "absolute", left: 10, right: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  pvField: { flex: 1, height: 18, borderRadius: 5, borderWidth: 1 },
  pvSend: { height: 18, paddingHorizontal: 8, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  pvSendText: { fontSize: 8.5, color: "#fff", fontWeight: "600" },
});
