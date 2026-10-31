// Vault ItemEnv: the Automations strip under the card. "Add to Automations" opens a session with the person's assistant that builds a connector from this key (the skill does the work; the
// message carries the app name and the handle, never a value). Below it, the Automations whose steps already use the key. A blocker is one sentence and one button, never a raw error.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useOnline, useVaultData } from "../layout/data.tsx";
import type { ItemKind } from "../layout/model.ts";
import { Btn, Glyph } from "../layout/parts.tsx";
import { GATE_TEXT, gateFor, offersAutomations, stepsLine, usedByOf } from "./automations.ts";
import type { AiAccount, BuilderStatus, UsedBy } from "./automations.ts";
import { PendingSecrets, pendingSlots } from "./PendingSecrets.tsx";
import type { PendingSlot } from "./PendingSecrets.tsx";

export interface AutomationsRowProps { item: { id: string; name: string; handle: string; kind: ItemKind; yourLevel: string; folderId: string } }

export function AutomationsRow({ item }: AutomationsRowProps): ReactElement | null {
  const data = useVaultData();
  const online = useOnline();
  const [accounts, setAccounts] = useState<readonly AiAccount[] | null>(null);
  const [uses, setUses] = useState<UsedBy[] | null>(null);
  const [tick, setTick] = useState(0);
  const [builder, setBuilder] = useState<BuilderStatus | null>(null);
  const [asked, setAsked] = useState(false);
  const [pending, setPending] = useState<PendingSlot[]>([]);
  const assistant = data.assistantId;
  const offers = offersAutomations(item.kind);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const out = (await data.call("providers.list", {})) as { providers?: { state?: unknown }[] } | null;
        if (live) setAccounts((out?.providers ?? []).map((p) => ({ state: typeof p.state === "string" ? p.state : "ok" })));
      } catch { if (live) setAccounts(null); }
    })();
    return () => { live = false; };
  }, [data, tick]);
  useEffect(() => {
    if (!assistant || !offers) return undefined;
    let live = true;
    void (async () => {
      try {
        let st = (await data.call("access.connector_builder.status", { agentId: assistant })) as BuilderStatus;
        // a Personal Space is the person's own: their assistant is allowed to build connectors without a tap
        if (!st.allowed && st.canGrant && data.personal === true) { await data.call("access.connector_builder.grant", { agentId: assistant }); st = { allowed: true, canGrant: true }; }
        if (live) setBuilder(st);
      } catch { if (live) setBuilder(null); }
    })();
    return () => { live = false; };
  }, [data, assistant, offers, tick]);
  useEffect(() => {
    if (!offers) return undefined;
    let live = true;
    void (async () => {
      try {
        const [conns, cons] = await Promise.all([data.call("connections.list", {}), data.call("connectors.list", {})]);
        if (live) setPending(pendingSlots(conns, cons, item.handle));
      } catch { if (live) setPending([]); }
    })();
    return () => { live = false; };
  }, [data, item.handle, offers, tick]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try { const out = await data.call("automations.vault_usage", { handle: item.handle }); if (live) setUses(usedByOf(out)); } catch { if (live) setUses([]); }
    })();
    return () => { live = false; };
  }, [data, item.handle, tick]);

  const used = uses ?? [];
  if (!offers && used.length === 0) return null;
  const gate = gateFor({ online, yourLevel: item.yourLevel, accounts, builder, asked });
  const start = (): void => { if (gate.state === "ready") data.nav.addToAutomations?.({ id: item.id, name: item.name, handle: item.handle }); };
  const fix = (): void => {
    if (gate.state === "offline") setTick((n) => n + 1);
    else if (gate.state === "no_use") data.nav.ask?.("assistant", "chat", { kind: "vault_item", id: item.id, title: item.name });
    else if (gate.state === "no_ai" || gate.state === "ai_signin") data.nav.openAddProvider?.();
    else if (gate.state === "no_builder" && assistant) void data.call("access.connector_builder.grant", { agentId: assistant }).then(() => setTick((n) => n + 1), () => undefined);
    else if (gate.state === "ask_admin" && assistant) void data.call("tasks.create", { title: "Let the assistant build connectors", summary: `Give ${data.me.name}'s assistant the Connector builder role: Console, People, the assistant, Roles.`, assigned: { kind: "role", id: "rol_admin" } }).then(() => setAsked(true), () => undefined);
    else if (gate.state === "asked") setTick((n) => n + 1);
  };

  return (
    <View style={s.wrap} testID="item-automations">
      <View style={s.head}>
        <Text accessibilityRole="header" aria-level={2} style={s.h2}>Automations</Text>
        <View style={{ flex: 1 }} />
        {offers && data.nav.addToAutomations ? <Btn label="Add to Automations" icon="wand" primary={gate.state === "ready"} disabled={gate.state !== "ready"} onPress={start} testID="item-add-automations" /> : null}
      </View>
      {offers && gate.state !== "ready" ? (
        <View style={s.notice} accessibilityRole="alert" testID={`auto-gate-${gate.state}`}>
          <Glyph name={gate.state === "offline" ? "lock" : gate.state === "no_builder" || gate.state === "ask_admin" || gate.state === "asked" ? "share" : "providers"} size={15} />
          <Text style={s.noticeText}>{GATE_TEXT[gate.state].text}</Text>
          <Btn label={GATE_TEXT[gate.state].fix} onPress={fix} testID="auto-gate-fix" />
        </View>
      ) : null}
      <PendingSecrets slots={pending} folderId={item.folderId} onSaved={() => setTick((n) => n + 1)} />
      {used.length === 0 ? (
        <Text style={s.note} testID="item-used-none">{offers ? "No Automation uses this key yet. Add it to build a connector from it." : "No Automation uses this item."}</Text>
      ) : (
        <View testID="item-used-by">
          {used.map((u) => (
            <Row
              key={u.automationId} id={u.automationId} title={u.name}
              trailing={<View style={s.trail}><Text numberOfLines={1} style={s.useSteps}>{u.steps.length === 1 ? u.steps[0]!.title : stepsLine(u.steps.length)}</Text><Glyph name="chevron" size={13} /></View>}
              onPress={() => data.nav.openAutomation?.(u.automationId)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 18 },
  head: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  h2: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  notice: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, marginBottom: 8, backgroundColor: "var(--accent-wash)" as string },
  noticeText: { flex: 1, minWidth: 180, fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 4, paddingVertical: 4 },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  useSteps: { maxWidth: 160, fontSize: 12.5, color: "var(--ink-3)" as string },
});
