// Vault > Advanced > Policy (spec 2.17; capabilities vault.policy.get and vault.policy.set): who may export a folder as .env, the longest a download link lasts, and whether a reveal asks for a reason.
// Restricted items are never exported and that rule is shown, not offered. Only people who manage Vault policy can read or change it: anyone else sees that, not a form. A change is one call and the page says
// what was saved; Save stays off until something differs from what is stored.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { Info } from "../../../../../../ui/src/Tip/index.tsx";
import { useVaultData } from "./data.tsx";
import { EXPIRY_CHOICES, expiryLabel } from "./model.ts";
import { loadVaultPolicy, policyDirty, saveVaultPolicy, toggledRole } from "./policy-actions.ts";
import type { PolicyLoad, VaultPolicy } from "./policy-actions.ts";
import { Btn, Glyph, Toggle } from "./parts.tsx";

type Load = { state: "loading" } | { state: "error"; message: string } | PolicyLoad;

function anchorOf(e: unknown): { x: number; y: number } {
  const t = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget;
  const r = t?.getBoundingClientRect?.();
  return r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 };
}

/** "owner" is shown as "Owner", "front_desk" as "Front desk"; the stored name stays as it is. */
export const roleLabel = (name: string): string => { const t = name.replace(/[_-]+/g, " ").trim(); return t === "" ? name : t.charAt(0).toUpperCase() + t.slice(1); };

export function PolicyView({ onClose }: { onClose(): void }): ReactElement {
  const data = useVaultData();
  const menu = useMenu();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [draft, setDraft] = useState<VaultPolicy | null>(null);
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ text: string; kind: "ok" | "error" } | null>(null);

  useEffect(() => {
    let live = true;
    void loadVaultPolicy(data.call).then(
      (got) => { if (!live) return; setLoad(got); if (got.state === "ready") setDraft(got.saved); },
      (e: unknown) => { if (live) setLoad({ state: "error", message: e instanceof Error ? e.message : "Couldn't load the policy" }); },
    );
    return () => { live = false; };
  }, [data, tries]);

  const head = <View style={s.head}><Btn label="Back" icon="back" onPress={onClose} testID="vault-policy-back" /><Text accessibilityRole="header" style={s.title}>Policy</Text><Info help="Rules for taking values out of the Vault" /></View>;
  if (load.state === "loading" || draft === null && load.state === "ready") return <View style={s.page} testID="vault-policy">{head}<Text style={s.note}>Loading the policy</Text></View>;
  if (load.state === "denied") return <View style={s.page} testID="vault-policy">{head}<States kind="empty" title="Only people who manage Vault policy can see this" /></View>;
  if (load.state === "error") return <View style={s.page} testID="vault-policy">{head}<States kind="error" message={load.message} retryable onRetry={() => { setLoad({ state: "loading" }); setTries((n) => n + 1); }} /></View>;
  if (draft === null) return <View style={s.page} testID="vault-policy">{head}</View>;
  const saved = load.saved;
  const dirty = policyDirty(draft, saved);
  const toggleRole = (name: string): void => setDraft(toggledRole(draft, name));
  const save = (): void => {
    setBusy(true); setLine(null);
    void saveVaultPolicy(data.call, draft).then(
      (policy) => { setLoad({ state: "ready", saved: policy, roles: load.roles }); setDraft(policy); setLine({ kind: "ok", text: "Policy saved" }); },
      (e: unknown) => setLine({ kind: "error", text: e instanceof Error ? e.message : "The policy was not saved" }),
    ).finally(() => setBusy(false));
  };
  const pick = (e: unknown): void => {
    const at = anchorOf(e);
    menu.show(EXPIRY_CHOICES.map((c) => ({ label: c.label, checked: draft.pullExpiryMax === c.key, onSelect: () => setDraft({ ...draft, pullExpiryMax: c.key }) })), at.x, at.y);
  };
  return (
    <View style={s.page} testID="vault-policy">
      {menu.element}
      {head}
      <Text style={s.group}>Who may export a folder as .env</Text>
      {load.roles.map((name) => (
        <Row
          key={name} id={`vault-policy-role-${name}`} title={roleLabel(name)} note={draft.exportRoles.includes(name) ? "May export" : "May not export"} tall onPress={() => toggleRole(name)}
          trailing={draft.exportRoles.includes(name) ? <Glyph name="check" color="var(--accent)" /> : null}
        />
      ))}
      <Text style={s.group}>Longest a download link lasts</Text>
      <Row
        id="vault-policy-expiry" title={expiryLabel(draft.pullExpiryMax)} tall onPress={pick}
        trailing={<View style={s.trail}><Info help="A link made for an export can last up to this long" /><Text style={s.pickText}>Change</Text></View>}
      />
      <Text style={s.group}>Revealing a value</Text>
      <Row
        id="vault-policy-reason" title="Ask for a reason" tall
        trailing={<View style={s.trail}><Info help={draft.revealNeedsReason ? "Anyone who reveals a value says why first" : "A reveal is logged without asking why"} /><Toggle on={draft.revealNeedsReason} label="Ask for a reason before a reveal" onChange={(v) => setDraft({ ...draft, revealNeedsReason: v })} testID="vault-policy-reason-switch" /></View>}
      />
      <Row id="vault-policy-restricted" title="Restricted items are never exported" tall trailing={<View style={s.trail}><Info help="This rule cannot be turned off" /><Glyph name="lock" /></View>} />
      <View style={s.foot}>
        <Btn label={busy ? "Saving…" : "Save policy"} primary disabled={busy || !dirty} why="No changes to save" onPress={save} testID="vault-policy-save" />
        <Btn label="Discard changes" disabled={busy || !dirty} why="No changes to discard" onPress={() => { setDraft(saved); setLine(null); }} testID="vault-policy-discard" />
        {line ? <Text accessibilityRole={line.kind === "error" ? "alert" : "text"} style={[s.line, line.kind === "error" && s.lineError]}>{line.text}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, minWidth: 0, maxWidth: 760, padding: 24, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 20, fontWeight: "600", color: "var(--ink)" as string },
  note: { fontSize: 13, color: "var(--ink-3)" as string, marginBottom: 6 },
  group: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 2 },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  pickText: { fontSize: 13, color: "var(--accent)" as string },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" },
  line: { fontSize: 13, color: "var(--ok)" as string },
  lineError: { color: "var(--danger)" as string },
});

