// Vault ItemEnv: the Automations strip under the card. "Add to Automations" opens a session with the person's assistant that builds a connector from this key (the skill does the work; the
// message carries the app name and the handle, never a value). Below it, the Automations whose steps already use the key. A blocker is one sentence and one button, never a raw error.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useOnline, useVaultData } from "../layout/data.tsx";
import type { ItemKind } from "../layout/model.ts";
import { Btn, Glyph, IconBtn } from "../layout/parts.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { GATE_TEXT, blockedNote, gateFor, hiddenOf, offersAutomations, stepsLine, usedByOf } from "./automations.ts";
import type { AiAccount, BuilderStatus, UsedBy } from "./automations.ts";
import { PendingSecrets, pendingSlots } from "./PendingSecrets.tsx";
import type { PendingSlot } from "./PendingSecrets.tsx";

export interface AutomationsRowProps { item: { id: string; name: string; handle: string; kind: ItemKind; yourLevel: string; folderId: string } }

export function AutomationsRow({ item }: AutomationsRowProps): ReactElement | null {
  const data = useVaultData();
  const online = useOnline();
  const [accounts, setAccounts] = useState<readonly AiAccount[] | null>(null);
  const [uses, setUses] = useState<UsedBy[] | null>(null);
  const [hidden, setHidden] = useState(0);
  // where this key may be sent without asking: hosts a person approved (Always allow on a held test read)
  const [sentTo, setSentTo] = useState<{ host: string; usedBy: string[]; hidden: number }[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newHost, setNewHost] = useState("");
  const [hostError, setHostError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [builder, setBuilder] = useState<BuilderStatus | null>(null);
  const [asked, setAsked] = useState(false);
  const [pending, setPending] = useState<PendingSlot[]>([]);
  // an AI account's API key is saved as a key item, but it is the person's AI, not an app to connect: it offers no connector
  const [aiKey, setAiKey] = useState<boolean | null>(null);
  const assistant = data.assistantId;
  const offers = offersAutomations(item.kind) && aiKey === false;
  useEffect(() => {
    if (!offersAutomations(item.kind)) return undefined;
    let live = true;
    void (async () => {
      try {
        const out = (await data.call("providers.list", {})) as { providers?: { itemId?: unknown }[] } | null;
        if (live) setAiKey((out?.providers ?? []).some((p) => p.itemId === item.id));
      } catch { if (live) setAiKey(false); }
    })();
    return () => { live = false; };
  }, [data, item.id, item.kind]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const out = (await data.call("engine.accounts.list", {})) as { accounts?: { status?: unknown }[] } | null;
        // the Vault's own words for a state: signed out is "needs_sign_in", failing is "failing"
        if (live) setAccounts((out?.accounts ?? []).map((a) => ({ state: a.status === "expired" ? "needs_sign_in" : a.status === "failed" ? "failing" : "ok" })));
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
      try { const out = await data.call("automations.vault_usage", { handle: item.handle }); if (live) { setUses(usedByOf(out)); setHidden(hiddenOf(out)); } } catch { if (live) setUses([]); }
    })();
    return () => { live = false; };
  }, [data, item.handle, tick]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const out = (await data.call("automations.key_hosts.list", { itemId: item.id })) as { hosts?: { host?: unknown; usedBy?: unknown; hidden?: unknown }[] } | null;
        if (live) setSentTo((out?.hosts ?? []).flatMap((h) => (typeof h.host === "string" ? [{ host: h.host, usedBy: Array.isArray(h.usedBy) ? h.usedBy.filter((x): x is string => typeof x === "string") : [], hidden: typeof h.hidden === "number" ? h.hidden : 0 }] : [])));
      } catch { if (live) setSentTo([]); }
    })();
    return () => { live = false; };
  }, [data, item.id, tick]);
  const mayUse = item.yourLevel === "use" || item.yourLevel === "edit" || item.yourLevel === "manage";
  const forget = (host: string): void => { setConfirming(null); void data.call("automations.key_hosts.remove", { itemId: item.id, host }).then(() => setTick((n) => n + 1), () => undefined); };
  // a host something sends this key to asks first, naming what stops
  const askForget = (h: { host: string; usedBy: string[]; hidden: number }): void => { if (h.usedBy.length + h.hidden === 0) forget(h.host); else setConfirming(h.host); };
  const allowHost = (): void => {
    setHostError(null);
    void data.call("automations.key_hosts.allow", { vaultItemId: item.id, host: newHost.trim() }).then(() => { setAdding(false); setNewHost(""); setTick((n) => n + 1); }, (e: unknown) => setHostError(e instanceof Error && e.message ? e.message : "That host could not be allowed."));
  };
  const named = (h: { usedBy: string[]; hidden: number }): string => { const parts = [...h.usedBy, ...(h.hidden > 0 ? [`${h.hidden} you cannot open`] : [])]; return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? ""; };

  const used = uses ?? [];
  if (!offers && used.length === 0 && hidden === 0 && sentTo.length === 0) return null;
  const gate = gateFor({ online, yourLevel: item.yourLevel, accounts, builder, asked });
  const start = (): void => { if (gate.state === "ready") data.nav.addToAutomations?.({ id: item.id, name: item.name, handle: item.handle }); };
  const toRecords = (): void => { if (gate.state === "ready") data.nav.syncToRecords?.({ id: item.id, name: item.name, handle: item.handle }); };
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
        <View style={{ flexGrow: 1 }} />
        {offers && data.nav.syncToRecords ? <Btn label="Sync to Records" icon="sync" disabled={gate.state !== "ready"} onPress={toRecords} testID="item-sync-records" /> : null}
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
      {used.length === 0 && hidden > 0 ? null : used.length === 0 ? (
        <Text style={s.note} testID="item-used-none">{offers ? "No Automation uses this key yet. Add it to build a connector from it." : "No Automation uses this item."}</Text>
      ) : (
        <View testID="item-used-by">
          {used.map((u) => (
            <Row
              key={u.automationId} id={u.automationId} title={u.name}
              {...(blockedNote(u) ? { note: blockedNote(u)!, noteLead: "Stops at next run", noteLeadTone: "warning" as const } : {})}
              trailing={<View style={s.trail}><Text numberOfLines={1} style={s.useSteps}>{u.steps.length === 1 ? u.steps[0]!.title : stepsLine(u.steps.length)}</Text><Glyph name="chevron" size={13} /></View>}
              onPress={() => data.nav.openAutomation?.(u.automationId)}
            />
          ))}
        </View>
      )}
      {hidden > 0 ? <Text style={s.note} testID="item-used-hidden">{used.length > 0 ? `and ${hidden} more you cannot open` : `${hidden === 1 ? "1 Automation" : `${hidden} Automations`} you cannot open ${hidden === 1 ? "uses" : "use"} this key`}</Text> : null}
      {sentTo.length > 0 || (offers && mayUse) ? (
        <View style={s.sent} testID="item-sent-to">
          <Text style={s.sentLabel}>Sent to</Text>
          {sentTo.map((h) => (
            <Row
              key={h.host} id={`sent-to-${h.host}`} title={h.host} inert
              leading={<Glyph name="globe" size={13} />}
              {...(h.usedBy.length > 0 ? { note: h.usedBy.length === 1 ? h.usedBy[0]! : `${h.usedBy.length} Automations` } : {})}
              {...(mayUse ? { trailing: <IconBtn icon="x" label={`Stop sending this key to ${h.host}`} onPress={() => askForget(h)} testID={`item-sent-to-remove-${h.host}`} /> } : {})}
            />
          ))}
          {(() => {
            // the removal's confirm, under the list: it names who sends the key to that host
            const h = sentTo.find((x) => x.host === confirming);
            return h ? (
              <View style={s.notice} accessibilityRole="alert" testID="item-sent-to-confirm">
                <Text style={s.noticeText}>{`${named(h)} ${h.usedBy.length + h.hidden === 1 ? "sends" : "send"} this key there. Their next Run stops until you allow it again.`}</Text>
                <Btn label="Remove" onPress={() => forget(h.host)} testID="item-sent-to-confirm-yes" />
                <Btn label="Cancel" onPress={() => setConfirming(null)} testID="item-sent-to-confirm-no" />
              </View>
            ) : null;
          })()}
          {adding ? (
            <View style={s.sentRow}>
              <TextField value={newHost} onChangeText={setNewHost} placeholder="api.example.com" autoCapitalize="none" autoCorrect={false} onSubmitEditing={allowHost} style={{ flex: 1 }} testID="item-sent-to-host" />
              <Btn label="Allow" primary onPress={allowHost} disabled={newHost.trim() === ""} testID="item-sent-to-allow" />
              <Btn label="Cancel" onPress={() => { setAdding(false); setNewHost(""); setHostError(null); }} testID="item-sent-to-add-no" />
            </View>
          ) : mayUse ? <Btn label="Allow a host" icon="plus" onPress={() => setAdding(true)} testID="item-sent-to-add" /> : null}
          {hostError ? <Text style={s.note} accessibilityRole="alert">{hostError}</Text> : null}
          <Text style={s.note}>This key goes only to these hosts. Removing one stops anything that sends it there.</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 18 },
  // on a phone the two buttons go under the heading rather than past the edge
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 4, rowGap: 6, marginBottom: 6 },
  h2: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  notice: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, marginBottom: 8, backgroundColor: "var(--accent-wash)" as string },
  noticeText: { flex: 1, minWidth: 180, fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 4, paddingVertical: 4 },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  sent: { marginTop: 8, paddingHorizontal: 4, gap: 2 },
  sentLabel: { fontSize: 12, color: "var(--ink-3)" as string, marginBottom: 2 },
  sentRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  useSteps: { maxWidth: 160, fontSize: 12.5, color: "var(--ink-3)" as string },
});
