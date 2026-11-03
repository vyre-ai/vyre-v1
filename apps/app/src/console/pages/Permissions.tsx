// Console > Permissions (owner approved, 3 Nov 2026): who may do what in this Space. Roles across (the five built-in ones always; custom roles on request), the permission catalogue down
// by area, each row opening into its permissions. A cell says what the role gives (Allowed, Ask an admin, Not allowed) and how many of its people differ because of an exception; opening it
// lists them and offers Add an exception. A custom role's cell changes the role (preview, then apply: audited); a built-in role is locked. Preview as shows what a person sees. On a phone the
// grid reads only, one role at a time. Everything is the access engine's own answer (access.roles.list, access.exceptions.*).
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Button, Help, Note, ReadState, Select, useAction, useRead } from "./shared.tsx";
import { AddExceptionSheet, ExceptionsList, PERMS, useExceptions } from "./exceptions.tsx";
import { CELL_WORD, areasOf, columns, differ, exceptionFor, isOwnerRole, roleCell } from "./permissions-model.ts";
import type { Cell, ExceptionLite, PersonLite, RoleLite } from "./permissions-model.ts";

const MARK: Readonly<Record<Cell, string>> = { allow: "✓", ask: "✋", no: "–" };
const INK: Readonly<Record<Cell, string>> = { allow: "var(--ok)", ask: "var(--warn)", no: "var(--ink-4)" };
const COL = 112;

export function Permissions(): ReactElement {
  const data = useConsoleData();
  const roles = useRead<{ roles: RoleLite[] }>("access.roles.list", { limit: 200 });
  const people = useRead<{ principals: PersonLite[] }>("access.principals.list", { limit: 500 });
  const ex = useExceptions();
  const width = useWindowDimensions().width, phone = width > 0 && width < 720;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(["automations"]));
  const [custom, setCustom] = useState(false);
  const [adding, setAdding] = useState<{ who?: string; what?: string } | null>(null);
  const [list, setList] = useState(false);
  const [preview, setPreview] = useState("");
  const [phoneRole, setPhoneRole] = useState("");
  const menu = useMenu();
  const refresh = (): void => { roles.refresh(); ex.refresh(); people.refresh(); };
  const action = useAction(refresh);
  const now = Date.now();
  const all = roles.data?.roles ?? [], folks = people.data?.principals ?? [], exceptions = ex.data?.exceptions ?? [];
  const cols = columns(all, custom);
  const areas = useMemo(() => areasOf(PERMS).map((a) => ({ ...a, perms: a.perms.filter((p) => !q.trim() || `${a.title} ${p.title} ${p.key}`.toLowerCase().includes(q.trim().toLowerCase())) })).filter((a) => a.perms.length), [q]);
  if (!roles.data) return <ReadState error={roles.error} retry={roles.refresh} />;

  const changeRole = async (r: RoleLite, key: string, give: boolean): Promise<void> => {
    const next = give ? [...new Set([...r.permissions, key])].sort() : r.permissions.filter((k) => k !== key);
    const pre = await action.run<{ previewHash?: string }>("access.roles.preview", { roleId: r.id, permissions: next }, "");
    if (pre?.previewHash) await action.run("access.roles.apply", { roleId: r.id, permissions: next, previewHash: pre.previewHash }, `${r.name}: ${PERMS.find((p) => p.key === key)?.title ?? key} is ${give ? "Allowed" : "not given"}`);
  };
  const cellMenu = (r: RoleLite, key: string, x: number, y: number): void => {
    const d = differ(r, key, folks, exceptions, now), title = PERMS.find((p) => p.key === key)?.title ?? key;
    const items: MenuEntry[] = [{ head: title }];
    if (d.length) {
      items.push({ head: `${d.length} ${d.length === 1 ? "person differs" : "people differ"}` });
      for (const { person, ex: e } of d) items.push({ label: person.name, hint: `${e.effect === "allow" ? "Allowed" : "Not allowed"} · exception${e.subject.kind === "group" ? ` for ${e.subject.name}` : ""}`, onSelect: () => data.nav.openPage("people", { personId: person.id }) });
      items.push({ separator: true }, { head: `${r.name}, everyone else` });
    }
    const cur = roleCell(r, key);
    if (r.builtIn) items.push({ label: CELL_WORD[cur], checked: true, disabled: true, reason: "A built-in role is locked. Clone it on Roles, or add an exception" });
    else for (const give of [true, false]) items.push({ label: give ? "Allowed" : "Not given (Ask an admin)", checked: (cur === "allow") === give, onSelect: () => { if ((cur === "allow") !== give) void changeRole(r, key, give); } });
    items.push({ separator: true }, { label: "Add an exception…", onSelect: () => setAdding({ ...(d[0] ? { who: `person:${d[0].person.id}` } : {}), what: `perm:${key}` }) });
    menu.show(items, x, y, "other");
  };

  const toolbar = <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
    <TextInput accessibilityLabel="Search permissions" placeholder="Search permissions" placeholderTextColor="var(--ink-4)" value={q} onChangeText={setQ} testID="perms-search"
      style={{ minWidth: 220, flexGrow: 0, height: 30, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 13 }} />
    {phone ? null : <Button label={`Exceptions ${exceptions.length}`} onPress={() => setList(!list)} testID="perms-exceptions" />}
    <View style={{ flex: 1 }} />
    {phone || !all.some((r) => !r.builtIn) ? null : <Button label={`${custom ? "Hide" : "Show"} ${all.filter((r) => !r.builtIn).length} custom roles`} onPress={() => setCustom(!custom)} testID="perms-custom" />}
    {phone ? null : <Select label="Preview as" value={preview} options={[{ key: "", title: "Nobody" }, ...folks.filter((p) => p.kind === "person" && !p.roles.includes("rol_owner")).map((p) => ({ key: p.id, title: p.name }))]} onChange={setPreview} />}
  </View>;

  if (phone) {
    const r = all.find((x) => x.id === phoneRole) ?? cols.find((x) => x.name === "Member") ?? cols[0]!;
    return <View testID="console-permissions">
      {toolbar}
      <Select label="Role" value={r.id} options={columns(all, true).map((x) => ({ key: x.id, title: x.name }))} onChange={setPhoneRole} />
      <Note>Read only on a phone. Change permissions on a computer.</Note>
      {/* ui-rows-lint: not a list (one section per permission area; the rows inside are ui/Row) */}
      {areas.map((a) => <Section key={a.area} title={a.title}><Group>{a.perms.map((p) => { const c = roleCell(r, p.key), n = differ(r, p.key, folks, exceptions, now).length; return <Row key={p.key} id={`perm-${p.key}`} title={p.title} {...(n ? { note: `${n} ${n === 1 ? "person differs" : "people differ"}` } : {})} trailing={<Text style={{ fontSize: 12.5, color: INK[c] as string }}>{`${MARK[c]} ${CELL_WORD[c]}`}</Text>} />; })}</Group></Section>)}
    </View>;
  }

  const cell = (r: RoleLite, key: string): ReactElement => {
    const c = roleCell(r, key), n = differ(r, key, folks, exceptions, now).length, owner = isOwnerRole(r);
    const face = <Text numberOfLines={1} style={{ fontSize: 12.5, color: owner ? "var(--ink-2)" as string : "var(--ink-2)" as string }}><Text style={{ color: INK[c] as string }}>{owner ? "🔒" : MARK[c]}</Text>{` ${CELL_WORD[c]}`}{n ? <Text style={{ color: "var(--ink-3)" as string, fontSize: 11 }}>{`  ${n}`}</Text> : null}</Text>;
    if (owner) return <View key={r.id} style={{ width: COL, alignItems: "center", justifyContent: "center" }} accessibilityLabel={`${r.name}: Allowed. The Owner can do everything`}>{face}</View>;
    return <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`${r.name}: ${PERMS.find((p) => p.key === key)?.title ?? key}. ${CELL_WORD[c]}${n ? `. ${n} ${n === 1 ? "person differs" : "people differ"}` : ""}`} testID={`perm-cell-${r.id}-${key}`}
      onPress={(ev) => { const rect = (ev?.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } })?.getBoundingClientRect?.(); cellMenu(r, key, rect?.left ?? 40, rect?.bottom ?? 120); }}
      style={({ hovered }: { hovered?: boolean }) => ({ width: COL, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: hovered ? "var(--hover)" as string : "transparent" })}>{face}</Pressable>;
  };
  const areaCell = (r: RoleLite, keys: readonly string[]): ReactElement => {
    const cs = keys.map((k) => roleCell(r, k)), same = cs.every((c) => c === cs[0]);
    return <View key={r.id} style={{ width: COL, alignItems: "center", justifyContent: "center" }}>
      {same || cs.length > 6 ? (same ? <Text style={{ fontSize: 12.5, color: "var(--ink-2)" as string }}><Text style={{ color: INK[cs[0]!] as string }}>{isOwnerRole(r) ? "🔒" : MARK[cs[0]!]}</Text>{` ${CELL_WORD[cs[0]!]}`}</Text>
        : <Text style={{ fontSize: 12.5, color: "var(--ink-2)" as string }}>{`${cs.filter((c) => c === "allow").length} of ${cs.length} allowed`}</Text>)
        : <Text accessibilityLabel={`${r.name}: ${cs.filter((c) => c === "allow").length} of ${cs.length} allowed`} numberOfLines={1} style={{ fontSize: 11, letterSpacing: 1 }}>{cs.map((c, i) => <Text key={i} style={{ color: INK[c] as string }}>{MARK[c]}</Text>)}</Text>}
    </View>;
  };
  const rows: ReactElement[] = [];
  for (const a of areas) {
    const isOpen = q.trim() !== "" || open.has(a.area);
    rows.push(<View key={`a-${a.area}`} style={{ flexDirection: "row", alignItems: "center", minHeight: 34, borderTopWidth: 1, borderTopColor: "var(--line)" as string }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} accessibilityLabel={`${a.title}, ${a.perms.length} permissions`} testID={`perm-area-${a.area}`} onPress={() => setOpen((s) => { const n = new Set(s); if (n.has(a.area)) n.delete(a.area); else n.add(a.area); return n; })} style={{ flex: 1, minWidth: 220, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 }}>
        <Text style={{ color: "var(--ink-3)" as string, fontSize: 11 }}>{isOpen ? "▾" : "▸"}</Text><Text style={{ fontWeight: "600", color: "var(--ink)" as string, fontSize: 13 }}>{a.title}</Text><Text style={{ color: "var(--ink-3)" as string, fontSize: 12 }}>{String(a.perms.length)}</Text>
      </Pressable>
      {cols.map((r) => areaCell(r, a.perms.map((p) => p.key)))}
    </View>);
    if (isOpen) for (const p of a.perms) rows.push(<View key={p.key} style={{ flexDirection: "row", alignItems: "center", minHeight: 34, borderTopWidth: 1, borderTopColor: "var(--line)" as string }}>
      <View style={{ flex: 1, minWidth: 220, paddingLeft: 34, paddingRight: 8, paddingVertical: 4 }}><Text style={{ fontSize: 13, color: "var(--ink-2)" as string }}>{p.title}</Text></View>
      {cols.map((r) => cell(r, p.key))}
    </View>);
  }
  const previewed = folks.find((p) => p.id === preview);
  return <View testID="console-permissions">
    {toolbar}
    {previewed ? <PreviewAs person={previewed} roles={all} exceptions={exceptions} now={now} /> : null}
    {list ? <ExceptionsList onAdd={() => setAdding({})} /> : null}
    <ScrollView horizontal>
      <View style={{ minWidth: 220 + COL * cols.length, flexGrow: 1, borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string }} testID="perms-grid">
        <View style={{ flexDirection: "row", alignItems: "center", height: 48, backgroundColor: "var(--sunk)" as string }}>
          <View style={{ flex: 1, minWidth: 220, paddingHorizontal: 12 }}><Text style={{ fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string }}>What people do</Text></View>
          {cols.map((r) => <View key={r.id} style={{ width: COL, alignItems: "center" }}><Text style={{ fontWeight: "600", color: "var(--ink)" as string, fontSize: 13 }}>{r.name}</Text><Text style={{ fontSize: 11, color: "var(--ink-3)" as string }}>{r.builtIn ? "Built in" : "Custom"}</Text></View>)}
        </View>
        {rows}
      </View>
    </ScrollView>
    <Help>The Owner is fixed. Ask an admin: they see it and can ask for it. A change applies at once and is in the Audit log.</Help>
    {action.note ? <Note>{action.note}</Note> : null}
    {menu.element}
    {adding ? <AddExceptionSheet preset={adding} onClose={() => setAdding(null)} onDone={refresh} /> : null}
  </View>;
}

/** Preview as a person: what their role and exceptions give, area by area, marked where an exception decides it. Their Records, as they see them, open from the Access checker. */
function PreviewAs({ person, roles, exceptions, now }: { person: PersonLite; roles: readonly RoleLite[]; exceptions: readonly ExceptionLite[]; now: number }): ReactElement {
  const held = roles.filter((r) => person.roles.includes(r.id));
  const value = (key: string): { c: Cell; ex: ExceptionLite | null } => {
    const e = exceptionFor(person, key, exceptions, now);
    if (e) return { c: e.effect === "allow" ? "allow" : (held.some((r) => r.name.toLowerCase() === "guest") ? "no" : "ask"), ex: e };
    const best = held.map((r) => roleCell(r, key)).sort((a, b) => ["allow", "ask", "no"].indexOf(a) - ["allow", "ask", "no"].indexOf(b))[0] ?? "no";
    return { c: best, ex: null };
  };
  return <Section title={`${person.name} sees`} testID="perms-preview">
    <Group>{areasOf(PERMS).map((a) => { const vs = a.perms.map((p) => ({ p, ...value(p.key) })), on = vs.filter((v) => v.c === "allow").length, marked = vs.filter((v) => v.ex).length;
      return <Row key={a.area} id={`preview-${a.area}`} title={a.title} note={`${on} of ${vs.length} allowed${marked ? ` · ${marked} by exception` : ""}`}
        trailing={<Text style={{ fontSize: 12, letterSpacing: 2 }}>{vs.map((v, i) => <Text key={i} style={{ color: INK[v.c] as string }}>{MARK[v.c]}</Text>)}</Text>} />; })}</Group>
  </Section>;
}
