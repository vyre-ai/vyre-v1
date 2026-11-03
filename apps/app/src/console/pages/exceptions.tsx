// Permission exceptions in the Console (owner approved, 3 Nov 2026): the Add an exception sheet, the list of those in force, a person's own section (People > a person > Access) and the
// Access checker's In the app. All read and write the access engine (access.exceptions.*): an exception is a row of its grants, folded into what a person holds.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { permissions as CATALOGUE } from "../../../../../generated/permissions.ts";
import { useConsoleData } from "../shell/data.tsx";
import { Empty, Group, Section } from "../shell/ui.tsx";
import { Button, Field, FormSheet, Help, Note, ReadState, Segmented, Select, useAction, useRead } from "./shared.tsx";
import { CELL_WORD, EFFECT_WORD, ENDS, allowsKey, areaTitle, areaWord, areasOf, endAt, exceptionFor, exceptionLine, mayGive, offersOwnOnly, whatOf } from "./permissions-model.ts";
import type { Cell, Effect, ExceptionLite, PermissionDef, PersonLite } from "./permissions-model.ts";
import { ownOnly, pairsFor } from "../../../../../lib/own-pairs.ts";

export const PERMS: readonly PermissionDef[] = CATALOGUE.map((p) => ({ key: p.key, area: p.area, title: p.title, risk: p.risk }));
type People = { principals: PersonLite[] };
type Groups = { groups: Array<{ id: string; name: string; members?: unknown[] }> };

/** The exceptions in force, for one person or group or for everyone. */
export function useExceptions(subject?: { kind: "person" | "group"; id: string }) {
  return useRead<{ exceptions: ExceptionLite[] }>("access.exceptions.list", subject ? { subject } : {}, { direct: true });
}
/** The signed-in admin's own permissions (identity.whoami), so the sheet never offers more than they hold. */
export function useMine(): ReadonlySet<string> | undefined {
  const who = useRead<{ permissions?: string[] }>("identity.whoami", {}, { direct: true });
  return useMemo(() => (who.data?.permissions ? new Set(who.data.permissions) : undefined), [who.data]);
}

/** One exception as a row: who (or what, on a person's own page), the value, the line, and Remove. */
export function ExceptionRow({ e, onRemove, busy, whoFirst = true }: { e: ExceptionLite; onRemove?: (() => void) | undefined; busy?: boolean; whoFirst?: boolean }): ReactElement {
  const what = whatOf(e, PERMS);
  return <Row id={`exception-${e.exceptionId}`} title={whoFirst ? `${e.subject.name} · ${what}` : what} note={`${e.subject.kind === "group" && !whoFirst ? `From ${e.subject.name} · ` : ""}${exceptionLine(e)}`}
    trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Text style={{ fontSize: 12.5, color: e.effect === "allow" ? "var(--ok)" as string : "var(--ink-2)" as string }}>{EFFECT_WORD[e.effect]}</Text>
      {onRemove ? <Button label="Remove" onPress={onRemove} disabled={busy === true} testID={`exception-remove-${e.exceptionId}`} /> : null}</View>} />;
}

/** Add an exception: who (a person or a group), what (a whole area or one permission), Allowed or Not allowed, when it ends, and why. */
export function AddExceptionSheet({ preset, onClose, onDone }: { preset?: { who?: string; what?: string } | undefined; onClose: () => void; onDone: () => void }): ReactElement {
  const people = useRead<People>("access.principals.list", { kind: "person", status: "active", limit: 500 });
  const groups = useRead<Groups>("access.groups.list", { limit: 500 });
  const mine = useMine();
  const [who, setWho] = useState(preset?.who ?? "");
  const [what, setWhat] = useState(preset?.what ?? "");
  const [effect, setEffect] = useState<Effect>("allow");
  const [ends, setEnds] = useState("none");
  const [why, setWhy] = useState("");
  const [note, setNote] = useState("");
  const action = useAction(onDone);
  const owners = new Set((people.data?.principals ?? []).filter((p) => p.roles.includes("rol_owner")).map((p) => p.id));
  const whoOptions = [{ key: "", title: "Pick a person or group" },
    ...(people.data?.principals ?? []).filter((p) => p.kind === "person").map((p) => ({ key: `person:${p.id}`, title: owners.has(p.id) ? `${p.name} (Owner, never restricted)` : p.name })),
    ...(groups.data?.groups ?? []).filter((g) => g.id !== "grp_everyone").map((g) => ({ key: `group:${g.id}`, title: `${g.name} (group)` }))];
  const whatOptions = [{ key: "", title: "Pick an area or a permission" }, ...areasOf(PERMS).flatMap((a) => [{ key: `area:${a.area}`, title: `All of ${a.title}` }, ...a.perms.map((p) => ({ key: `perm:${p.key}`, title: `${a.title}: ${p.title}` }))])];
  const keys = what.startsWith("area:") ? PERMS.filter((p) => p.area === what.slice(5)).map((p) => p.key) : what.startsWith("perm:") ? [what.slice(5)] : [];
  const sel = what.startsWith("area:") ? { area: what.slice(5) } : { perms: keys };
  const ownOffered = keys.length > 0 && offersOwnOnly(sel);
  const effective: Effect = effect === "own" && !ownOffered ? "allow" : effect;
  const give = mayGive(effective, keys, mine, ownOffered ? ownOnly(pairsFor(sel)).allow : []);
  const ownerPicked = who.startsWith("person:") && owners.has(who.slice(7));
  const ready = who !== "" && keys.length > 0 && give.ok && !(ownerPicked && effective !== "allow");
  const why_ = who === "" ? "Pick who first" : keys.length === 0 ? "Pick an area or a permission" : !give.ok ? give.why : ownerPicked && effective !== "allow" ? "The Owner is never restricted" : undefined;
  const submit = async (): Promise<void> => {
    if (!ready) return;
    const [kind, id] = who.split(":") as ["person" | "group", string];
    const until = endAt(ends, Date.now());
    const out = await action.run("access.exceptions.set", { subject: { kind, id }, ...(what.startsWith("area:") ? { area: what.slice(5) } : { perms: keys }), effect: effective, ...(until !== undefined ? { until } : {}), ...(why.trim() ? { why: why.trim() } : {}), idempotencyKey: "x" }, "Exception added");
    if (out) { onDone(); onClose(); } else setNote(action.note);
  };
  return <FormSheet title="Add an exception" onClose={onClose} onSubmit={() => void submit()} submit="Add exception" disabled={!ready || action.busy} why={why_} testID="exception-sheet"
    note="You can give up to what you hold yourself. A restriction is never more than you hold. The Owner is never restricted. Agents acting for this person follow it too. When it ends it lapses on its own and the Audit log says so.">
    <Select label="Who" value={who} options={whoOptions} onChange={setWho} />
    <Select label="What" value={what} options={whatOptions} onChange={setWhat} />
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 12, color: "var(--ink-2)" as string }}>Value</Text>
      <Segmented options={[{ key: "allow", title: "Allowed" }, ...(ownOffered ? [{ key: "own", title: "Own only" }] : []), { key: "deny", title: "Not allowed" }]} value={effective} onChange={(k) => setEffect(k as Effect)} />
      {/* visible words under the value, not a tooltip: what the choice does, or why it can't be made */}
      {who === "" || !give.ok || effective === "own" ? <Text testID="exception-value-note" style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{who === "" ? "Pick who first." : !give.ok ? `That is more than you hold yourself for ${keys.length === 1 ? "this permission" : "some of these"}.` : `Own only: ${pairsFor(sel).map((p) => p.title).join("; ")}. Their own part stays; the Space part is not allowed.`}</Text> : null}
    </View>
    <Select label="Ends" value={ends} options={ENDS.map((e) => ({ key: e.key, title: e.title }))} onChange={setEnds} />
    <Field label="Reason (optional, shown to admins)" value={why} onChange={setWhy} testID="exception-why" />
    {note || action.note ? <Note>{note || action.note}</Note> : null}
  </FormSheet>;
}

/** Every exception in force, with Remove and Add an exception. */
export function ExceptionsList({ onAdd }: { onAdd: () => void }): ReactElement {
  const list = useExceptions();
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  return <Section title="Exceptions" count={list.data.exceptions.length} right={<Button label="Add an exception" onPress={onAdd} testID="exception-add" />} testID="exceptions-list">
    {list.data.exceptions.length ? <Group>{list.data.exceptions.map((e) => <ExceptionRow key={e.exceptionId} e={e} busy={action.busy} onRemove={() => void action.run("access.exceptions.remove", { exceptionId: e.exceptionId }, "Exception removed")} />)}</Group>
      : <Empty icon="key">No exceptions. Everyone has what their role gives.</Empty>}
    {action.note ? <Note>{action.note}</Note> : null}
  </Section>;
}

/** People > a person > Access: their exceptions (their own, and those of their groups), Remove and Add, and the note that their agents follow them. */
export function PersonExceptions({ person, owner }: { person: { id: string; name: string; groups: readonly string[] }; owner: boolean }): ReactElement {
  const all = useExceptions();
  const [adding, setAdding] = useState(false);
  const action = useAction(all.refresh);
  const first = person.name.split(" ")[0] ?? person.name;
  const rows = (all.data?.exceptions ?? []).filter((e) => (e.subject.kind === "person" && e.subject.id === person.id) || (e.subject.kind === "group" && person.groups.includes(e.subject.id)));
  return <Section title="Exceptions" count={rows.length} right={owner ? <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>The Owner is never restricted</Text> : <Button label="Add an exception" onPress={() => setAdding(true)} testID="person-exception-add" />} testID="person-exceptions">
    {!all.data ? <ReadState error={all.error} retry={all.refresh} /> : rows.length
      ? <Group>{rows.map((e) => <ExceptionRow key={e.exceptionId} e={e} whoFirst={false} busy={action.busy} {...(e.subject.kind === "person" ? { onRemove: () => void action.run("access.exceptions.remove", { exceptionId: e.exceptionId }, "Exception removed") } : {})} />)}</Group>
      : <Empty icon="key">{`None. ${first} has what their role gives.`}</Empty>}
    {owner ? null : <Help>{`Agents acting for ${first} follow these too.`}</Help>}
    {action.note ? <Note>{action.note}</Note> : null}
    {adding ? <AddExceptionSheet preset={{ who: `person:${person.id}` }} onClose={() => setAdding(false)} onDone={all.refresh} /> : null}
  </Section>;
}

/**
 * People > a person > Access, What they can do: the matrix's rows in plain words, each with the person's value (role plus exceptions), Own only where an area's own part is allowed and
 * its Space part is not, and "exception" where an exception decided it.
 */
export function WhatTheyCanDo({ person, permissions, guest }: { person: PersonLite; permissions: readonly string[]; guest: boolean }): ReactElement {
  const all = useExceptions();
  const ex = all.data?.exceptions ?? [];
  const now = Date.now(), held = new Set(permissions);
  // a permission an exception refuses reads Not allowed: an admin chose it, there is nothing to ask for
  const value = (key: string): Cell => { const e = exceptionFor(person, key, ex, now); return held.has(key) ? "allow" : (e && !allowsKey(e, key)) || guest ? "no" : "ask"; };
  return <View testID="person-can-do" style={{ gap: 8 }}>
    {/* ui-rows-lint: not a list (one section per permission area; the rows inside are ui/Row) */}
    {areasOf(PERMS).map((a) => {
      const cells = a.perms.map((p) => value(p.key)), word = areaWord(a.area, (k) => held.has(k), cells);
      const on = cells.filter((c) => c === "allow").length;
      return <Section key={a.area} title={a.title} right={<Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{word ? CELL_WORD[word] : `${on} of ${cells.length} allowed`}</Text>}>
        <Group>{a.perms.map((p) => { const e = exceptionFor(person, p.key, ex, now), c = value(p.key);
          return <Row key={p.key} id={`can-${p.key}`} title={p.title} {...(e ? { note: `Exception${e.subject.kind === "group" ? ` for ${e.subject.name}` : ""}: ${allowsKey(e, p.key) ? "Allowed" : "Not allowed"}` } : {})}
            trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{e ? <Text style={{ fontSize: 11, color: "var(--accent)" as string }}>exception</Text> : null}<Text style={{ fontSize: 12.5, color: "var(--ink-2)" as string }}>{CELL_WORD[c]}</Text></View>} />; })}</Group>
      </Section>;
    })}
  </View>;
}

/** The permission keys that an exception touches for this person: their own, or their groups'. */
export function exceptionKeys(person: { id: string; groups: readonly string[] }, ex: readonly ExceptionLite[]): Set<string> {
  const out = new Set<string>();
  for (const e of ex) if ((e.subject.kind === "person" && e.subject.id === person.id) || (e.subject.kind === "group" && person.groups.includes(e.subject.id))) for (const k of e.perms) out.add(k);
  return out;
}

/** The Access checker's In the app: may this person do what a permission covers, and why. The heading is the answer; the body says where it comes from. */
export function InTheApp(): ReactElement {
  const data = useConsoleData();
  const people = useRead<People>("access.principals.list", { limit: 500 });
  const [who, setWho] = useState(data.me.id);
  const [perm, setPerm] = useState(PERMS[0]?.key ?? "");
  const out = useRead<{ allowed: boolean; source: string; words: string }>("access.exceptions.explain", { principal: who, perm }, { direct: true, enabled: who !== "" && perm !== "" });
  const options = (people.data?.principals ?? []).filter((p) => p.kind === "person" || p.kind === "agent").map((p) => ({ key: p.id, title: p.kind === "agent" ? `${p.name} (agent)` : p.name }));
  return <Section title="In the app" right={<Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>Permissions, with exceptions</Text>} testID="checker-in-app">
    <Group>
      <Select label="Person or agent" value={who} options={options.length ? options : [{ key: data.me.id, title: data.me.name }]} onChange={setWho} />
      <Select label="Permission" value={perm} options={areasOf(PERMS).flatMap((a) => a.perms.map((p) => ({ key: p.key, title: `${a.title}: ${p.title}` })))} onChange={setPerm} />
    </Group>
    {out.data ? <View testID="checker-in-app-verdict" style={{ paddingVertical: 10, paddingHorizontal: 12, gap: 4, borderRadius: 10, backgroundColor: "var(--sunk)" as string }}>
      <Text style={{ fontWeight: "600", color: "var(--ink)" as string }}>{out.data.allowed ? "Allowed" : "Not allowed"}</Text>
      <Text style={{ color: "var(--ink-2)" as string }}>{out.data.words}</Text>
    </View> : out.error ? <Note>{out.error}</Note> : null}
    <Help>A person's own exception beats a group's, which beats their role. An agent gets the answer of the person it acts for.</Help>
  </Section>;
}

export { areaTitle };
