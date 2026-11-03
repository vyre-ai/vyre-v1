// Space AI accounts (owner, 3 Nov; north star prototype/vyre-vault.html, #vault,space:team,at:ai-space): the AI keys the Space pays with, any number, each saying what it pays for. A row: the
// provider's mark, its name, health and a "Used for" line. Its sheet: Team chats (with Who), Automations, Goals, Agents' own work (with Which), and a monthly cap, saved with
// providers.uses.set (l-vaultfix). Admins change them; everyone else sees them read-only. People's own accounts always come first in their own chats.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useVaultData } from "../layout/data.tsx";
import { Btn, LogoTile } from "../layout/parts.tsx";
import { Sheet } from "../layout/Sheet.tsx";
import { formOf, usedForLine, usesOf } from "./space-ai.ts";
import type { Uses, UsesForm } from "./space-ai.ts";

interface Row { id: string; name: string; providerKey: string; scope: string; state?: string; spaceKey?: boolean; uses?: Uses; usesSet?: boolean; capCents?: number | null }

/** The rows of the Space AI accounts tab: every key shared with the Space (the old single Space AI key is one of them). */
export function SpaceAiAccounts({ mayManage }: { mayManage: boolean }): ReactElement {
  const data = useVaultData();
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const load = useCallback(() => {
    void (data.call("providers.list", {}) as Promise<{ providers: Row[] }>).then((o) => setRows(o.providers.filter((p) => p.scope === "shared" || p.spaceKey === true)), () => setRows([]));
  }, [data]);
  useEffect(() => {
    load();
    void (data.call("access.groups.list", {}) as Promise<{ groups: Array<{ id: string; name: string }> }>).then((o) => setGroups(o.groups), () => undefined);
    void (data.call("agents.list", {}) as Promise<{ agents: Array<{ agentId: string; name: string }> }>).then((o) => setAgents(o.agents.map((a) => ({ id: a.agentId, name: a.name }))), () => undefined);
  }, [data, load]);
  useEffect(() => { setNames(Object.fromEntries([...groups, ...agents].map((x) => [x.id, x.name]))); }, [groups, agents]);
  const nameOf = (id: string): string => names[id] ?? id;
  return (
    <View testID="space-ai-accounts">
      {rows === null ? <Text style={[s.quiet, s.pad]}>Loading</Text> : rows.length === 0 ? (
        <Text style={[s.quiet, s.pad]} testID="space-ai-empty">{mayManage ? "No Space AI accounts yet. Press + to add one; it covers people with no AI account of their own, and whatever else you tick." : "No Space AI accounts yet. Admins add them."}</Text>
      ) : rows.map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => setOpen(r)} style={s.row} testID={`space-ai-${r.id}`}>
          <LogoTile name={r.name} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={s.name}>{r.name}</Text>
            <Text numberOfLines={1} style={s.quiet}>{usedForLine(r.uses ?? (r.spaceKey ? { teamChats: { who: "everyone" } } : undefined), r.capCents, nameOf)}</Text>
          </View>
          <Text style={[s.health, r.state === "ok" ? s.ok : null]}>{r.state === "ok" ? "Works" : "Check the key"}</Text>
        </Pressable>
      ))}
      {!mayManage && rows && rows.length > 0 ? <Text style={[s.quiet, s.pad]}>Admins add and change Space AI accounts.</Text> : null}
      {open ? <UsesSheet row={open} mayManage={mayManage} groups={groups} agents={agents} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} /> : null}
    </View>
  );
}

function UsesSheet({ row, mayManage, groups, agents, onClose, onSaved }: { row: Row; mayManage: boolean; groups: Array<{ id: string; name: string }>; agents: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => void }): ReactElement {
  const data = useVaultData();
  const { element, show } = useMenu();
  const [f, setF] = useState<UsesForm>(formOf(row.uses ?? (row.spaceKey ? { teamChats: { who: "everyone" } } : undefined), row.capCents));
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (k: "teamChats" | "automations" | "goals" | "agentWork"): void => { if (mayManage) setF((x) => ({ ...x, [k]: !x[k] })); };
  const pickMany = (e: unknown, all: string, list: Array<{ id: string; name: string }>, key: "who" | "which"): void => {
    if (!mayManage) return;
    const r = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
    show([{ label: all, checked: f[key].length === 0, onSelect: () => setF((x) => ({ ...x, [key]: [] })) }, { separator: true }, ...list.map((g) => ({ label: g.name, checked: f[key].includes(g.id), onSelect: () => setF((x) => ({ ...x, [key]: x[key].includes(g.id) ? x[key].filter((y) => y !== g.id) : [...x[key], g.id] })) }))], r?.left ?? 0, (r?.bottom ?? 0) + 4, "other");
  };
  const named = (ids: string[], list: Array<{ id: string; name: string }>, all: string): string => (ids.length ? ids.map((id) => list.find((x) => x.id === id)?.name ?? id).join(", ") : all);
  const save = async (): Promise<void> => {
    const out = usesOf(f);
    if (!out) { setLine("The cap is a whole number of dollars, or empty for none."); return; }
    setBusy(true);
    try { await data.call("providers.uses.set", { providerId: row.id, uses: out.uses, capCents: out.capCents }); onSaved(); }
    catch (e) { setLine((e as { message?: string }).message ?? "That did not save. Try again."); }
    finally { setBusy(false); }
  };
  const box = (k: "teamChats" | "automations" | "goals" | "agentWork", title: string, sub?: string): ReactElement => (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: f[k], disabled: !mayManage }} onPress={() => toggle(k)} style={s.box} testID={`uses-${k}`}>
      <View style={[s.tick, f[k] ? s.tickOn : null]}>{f[k] ? <Text style={s.tickMark}>✓</Text> : null}</View>
      <View style={{ flex: 1 }}><Text style={s.name}>{title}</Text>{sub ? <Text style={s.quiet}>{sub}</Text> : null}</View>
    </Pressable>
  );
  return (
    <Sheet title={row.name} onClose={onClose} testID="space-ai-sheet" icon={<LogoTile name={row.name} size={30} />} footer={mayManage ? <View style={s.foot}><Btn label="Cancel" onPress={onClose} /><Btn label={busy ? "Saving" : "Save"} primary onPress={() => { void save(); }} testID="uses-save" /></View> : <View style={s.foot}><Btn label="Close" onPress={onClose} /></View>}>
      <Text style={s.quiet}>People's own AI accounts always come first in their own chats.</Text>
      <Text style={s.label}>Used for</Text>
      {box("teamChats", "Team chats", "When someone has no AI account of their own")}
      {f.teamChats ? <Pressable accessibilityRole="button" onPress={(e) => pickMany(e, "Everyone", groups, "who")} style={s.sub} testID="uses-who"><Text style={s.quiet}>Who</Text><Text style={s.pick}>{named(f.who, groups, "Everyone")}</Text></Pressable> : null}
      {box("automations", "Automations")}
      {box("goals", "Goals")}
      {box("agentWork", "Agents' own work", "Routines, watchers and helpers that run with nobody asking")}
      {f.agentWork ? <Pressable accessibilityRole="button" onPress={(e) => pickMany(e, "All agents", agents, "which")} style={s.sub} testID="uses-which"><Text style={s.quiet}>Which</Text><Text style={s.pick}>{named(f.which, agents, "All agents")}</Text></Pressable> : null}
      <Text style={s.label}>Monthly spend cap</Text>
      <View style={s.capRow}><Text style={s.quiet}>$</Text><TextInput editable={mayManage} accessibilityLabel="Monthly spend cap in dollars" value={f.cap} onChangeText={(cap) => setF((x) => ({ ...x, cap }))} placeholder="No cap" placeholderTextColor="var(--ink-4)" style={s.cap} testID="uses-cap" /><Text style={s.quiet}>a month, then it stops and the next account takes over</Text></View>
      {line ? <Text style={s.error} accessibilityLiveRegion="polite">{line}</Text> : null}
      {element}
    </Sheet>
  );
}

const s = StyleSheet.create({
  pad: { paddingHorizontal: 14, paddingVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8 },
  name: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  quiet: { fontSize: 12, color: "var(--ink-3)" as string },
  health: { fontSize: 11.5, color: "var(--warn)" as string },
  ok: { color: "var(--ok)" as string },
  label: { fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string, marginTop: 14, marginBottom: 4 },
  box: { flexDirection: "row", gap: 10, paddingVertical: 7, alignItems: "flex-start" },
  tick: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: "var(--ink-4)" as string, alignItems: "center", justifyContent: "center", marginTop: 1 },
  tickOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  tickMark: { color: "var(--accent-ink)" as string, fontSize: 11, lineHeight: 12 },
  sub: { flexDirection: "row", gap: 10, alignItems: "center", marginLeft: 26, marginBottom: 4, height: 26 },
  pick: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  capRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cap: { width: 110, height: 30, paddingHorizontal: 8, borderRadius: 7, backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 13 },
  error: { fontSize: 12, color: "var(--danger)" as string, marginTop: 8 },
  foot: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
});
