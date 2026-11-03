// The Space's rules for connections, shown to admins under the list (the Console links here): who may add connections for the whole Space, and an allow-list that limits what anyone who is
// not an admin may add (registry names, https hosts or packages, one a line). Saved as it is changed; the list is saved with its own button.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useVaultData } from "../layout/data.tsx";
import { Btn, Glyph, Toggle } from "../layout/parts.tsx";
import { attemptKey, messageOf } from "./actions.ts";
import type { Policy } from "./model.ts";

const ADDERS: Record<Policy["spaceAdders"], string> = { admins: "Admins only", managers: "Admins and developers" };

export function RulesPanel({ policy, onSaved }: { policy: Policy; onSaved(text: string): void }): ReactElement {
  const data = useVaultData();
  const menu = useMenu();
  const [list, setList] = useState(policy.allowList.join("\n"));
  const [error, setError] = useState("");
  const save = async (patch: Partial<Policy>, said: string): Promise<void> => {
    setError("");
    try { await data.call("plugins.connections.policy_set", { ...patch, idempotencyKey: attemptKey() }); onSaved(said); }
    catch (e) { setError(messageOf(e)); }
  };
  const lines = list.split("\n").map((x) => x.trim()).filter(Boolean);
  const dirty = lines.join("\n") !== policy.allowList.join("\n");
  return (
    <View style={s.wrap} testID="connections-rules">
      {menu.element}
      <Text style={s.head} accessibilityRole="header">Rules for this Space</Text>
      <Row
        id="rules-adders" title="Who can add Space connections" note="Anyone can add their own. These people can also add one for everyone."
        trailing={<Btn label={ADDERS[policy.spaceAdders]} trailingIcon="chevd" onPress={(e) => { const r = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } })?.currentTarget?.getBoundingClientRect?.(); menu.show([
          { label: ADDERS.admins, checked: policy.spaceAdders === "admins", onSelect: () => { void save({ spaceAdders: "admins" }, "Only admins add Space connections now"); } },
          { label: ADDERS.managers, checked: policy.spaceAdders === "managers", onSelect: () => { void save({ spaceAdders: "managers" }, "Admins and developers add Space connections now"); } },
        ], r?.left ?? 0, (r?.bottom ?? 0) + 4, "other"); }} testID="rules-adders-pick" />}
      />
      <Row id="rules-allow" title="Allow-list" note={policy.allowListOn ? `Others can add only what is listed (${policy.allowList.length})` : "Off: people can add any server"} trailing={<Toggle on={policy.allowListOn} label="Allow-list" onChange={(on) => { void save({ allowListOn: on }, on ? "The allow-list is on" : "The allow-list is off"); }} testID="rules-allow-toggle" />} />
      {policy.allowListOn ? (
        <View style={s.listBox}>
          <Text style={s.label}>One a line: a registry name (com.notion/mcp), an https host (mcp.notion.com) or a package (@acme/server)</Text>
          <TextInput placeholderTextColor="var(--ink-4)" value={list} onChangeText={setList} multiline accessibilityLabel="Allowed servers" placeholder={"com.notion/mcp\nmcp.linear.app\n@modelcontextprotocol/server-github"} style={s.area} testID="rules-allow-list" />
          <View style={s.actions}><Glyph name="lock" /><Text style={s.quiet}>Admins are not held to the list.</Text><View style={{ flex: 1 }} /><Btn label="Save the list" primary disabled={!dirty} onPress={() => { void save({ allowList: lines }, "Saved the allow-list"); }} testID="rules-allow-save" /></View>
        </View>
      ) : null}
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 18, gap: 1 },
  head: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingBottom: 6, textTransform: "uppercase" as const, letterSpacing: 0.4 },
  listBox: { gap: 6, paddingHorizontal: 8, paddingTop: 6 },
  label: { fontSize: 12.5, color: "var(--ink-3)" as string },
  area: { minHeight: 90, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string, fontSize: 12.5, fontFamily: "var(--mono, ui-monospace, Menlo, monospace)" as string, textAlignVertical: "top" as const },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string, paddingHorizontal: 8 },
});
