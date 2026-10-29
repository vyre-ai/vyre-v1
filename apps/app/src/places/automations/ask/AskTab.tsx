// Ask on this Automation. The lines are the same kind of tab the rest of Vyre opens in Chats.
// Paste boxes keep the values. Saving calls Vault, then the existing connection create, then the step link.

import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { AskBundle } from "./bundle.ts";
import { scrubAskContext } from "./bundle.ts";
import {
  accountFromCreate, connectionCreateInput, firstFolderId, handleOf, itemIdOf, linesFor, linkAccount, planAsk, publicLine, savedLine, setupShape, vaultPutInput,
} from "./plan.ts";
import type { AskLine, AskStep, AskTurn, PasteSlot } from "./plan.ts";
import { shouldHunt } from "./hunt.ts";
import { placeSteps, placeWebhook, showTry, triggersFrom } from "./place.ts";
import type { TriggerOffer } from "./place.ts";
import { actionsFrom, proposalsFrom } from "./proposals.ts";
import type { StepProposal } from "./proposals.ts";
import { publicResult, readOffer } from "./read.ts";
import type { ReadRequest } from "./read.ts";
import type { AccountOption } from "../connect/accounts.ts";
import type { ConnectTarget } from "../connect/route.ts";
import type { Definition } from "../canvas/model.ts";

export function AskTab({ def, selectedId, accounts, steps, onChange, onOpenChat, onConnect, call }: {
  def: Definition;
  selectedId: string | null;
  accounts: readonly AccountOption[];
  steps: readonly AskStep[];
  onChange(next: Definition): void;
  onOpenChat(bundle: AskBundle): void;
  onConnect(target: ConnectTarget): void;
  call(cap: string, input: unknown): Promise<unknown>;
}): ReactElement {
  const [text, setText] = useState("");
  const [doc, setDoc] = useState("");
  const [lines, setLines] = useState<AskLine[]>([]);
  const [turn, setTurn] = useState<AskTurn | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<StepProposal[]>([]);
  const [hooks, setHooks] = useState<TriggerOffer[]>([]);
  const [linked, setLinked] = useState<AccountOption | null>(null);
  const [busy, setBusy] = useState(false);

  const accountNow = (): AccountOption | null => linked ?? (turn?.kind === "use" ? turn.account : null);

  const say = (line: string): void => {
    const safe = publicLine(line) || "That did not finish.";
    setLines((cur) => [...cur, { who: "vyre", say: safe }]);
  };

  const ask = (raw: string, fields?: { name: string; secret: boolean }[], action?: string | null): void => {
    const next = planAsk({ text: raw, accounts, steps, ...(fields ? { fields } : {}), ...(action ? { action } : {}) });
    setLines((cur) => [...cur, ...linesFor(raw, next)]);
    setTurn(next);
    setValues({});
    setText("");
  };

  const useAccount = (account: AccountOption, planned: Extract<AskTurn, { kind: "use" | "choose" | "paste" }>): boolean => {
    const linkedResult = linkAccount(def, { account, stepKey: planned.stepKey, nodeId: selectedId, action: planned.action });
    if ("error" in linkedResult) { say(linkedResult.error); return false; }
    onChange(linkedResult.def);
    setLinked(account);
    return true;
  };

  const save = async (planned: Extract<AskTurn, { kind: "paste" }>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const snapshot = values;
    try {
      const folders = await call("vault.folders.list", { scope: "mine" });
      const folderId = firstFolderId(folders);
      if (!folderId) throw new Error("Vault has no folder to put this in.");
      const built = vaultPutInput({ folderId, app: planned.app, slots: planned.slots, values: snapshot });
      if ("error" in built) throw new Error(built.error);
      const put = await call("vault.item.put", built.put);
      setValues({});
      const itemId = itemIdOf(put);
      const used = itemId ? await call("vault.use", { item: itemId, purpose: "automation step" }) : null;
      const handle = used ? handleOf(used) : null;
      let account: AccountOption | null = null;
      if (handle) {
        try {
          const created = await call("connections.create", connectionCreateInput({ app: planned.app, handle, slots: planned.slots }));
          account = accountFromCreate(created, planned.app);
        } catch { account = null; }
      }
      const linked = account ? useAccount(account, planned) : false;
      say(savedLine(built.name, linked));
    } catch (err) {
      setValues({});
      say(err instanceof Error ? err.message : "That did not save.");
    }
    setBusy(false);
  };

  const readDoc = async (): Promise<void> => {
    if (busy) return;
    let parsed: unknown;
    try { parsed = JSON.parse(doc); }
    catch { say("That is not a document this tab can read."); return; }
    setBusy(true);
    try {
      const out = await call("automations.draft_connector", { document: parsed });
      const shape = setupShape(out);
      setProposals(proposalsFrom(actionsFrom(out)));
      setHooks(triggersFrom(out));
      const raw = text.trim() || "use this document";
      if (shape.fields.length === 0 && shape.actions.length === 0) say("This document does not say how to sign in.");
      else ask(raw, shape.fields, shape.actions[0] ?? null);
    } catch (err) {
      say(err instanceof Error ? err.message : "That document was not read.");
    }
    setBusy(false);
  };

  const tryRead = async (req: ReadRequest): Promise<void> => {
    if (busy) return;
    const offer = readOffer(req);
    if (offer.kind === "hold") { say(offer.say); return; }
    setBusy(true);
    say(offer.say);
    try {
      const out = await call(offer.cap, offer.input);
      say(publicResult(out));
    } catch (err) {
      say(err instanceof Error ? err.message : "That read did not run.");
    }
    setBusy(false);
  };

  const submit = async (): Promise<void> => {
    const raw = text.trim();
    if (!raw || busy) return;
    const planned = planAsk({ text: raw, accounts, steps });
    if (!shouldHunt(planned)) {
      setProposals([]);
      setHooks([]);
      ask(raw);
      return;
    }
    setBusy(true);
    setProposals([]);
    setHooks([]);
    try {
      const out = await call("automations.draft_connector", { app: planned.app, intent: raw });
      const shape = setupShape(out);
      const nextProposals = proposalsFrom(actionsFrom(out));
      const offers = triggersFrom(out);
      setProposals(nextProposals);
      setHooks(offers);
      const next = planAsk({
        text: raw,
        accounts,
        steps,
        ...(shape.fields.length > 0 ? { fields: shape.fields } : {}),
        ...(shape.actions[0] ? { action: shape.actions[0] } : {}),
      });
      const shown = next.kind === "need_doc" && (nextProposals.length > 0 || offers.length > 0)
        ? { ...next, say: "The official document is drafted. Link a connection, then add a step." }
        : next;
      setLines((cur) => [...cur, ...linesFor(raw, shown)]);
      setTurn(next);
      setValues({});
      setText("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "That document did not load.";
      setLines((cur) => [...cur, ...linesFor(raw, { ...planned, say: message })]);
      setTurn(planned);
      setText("");
    }
    setBusy(false);
  };

  const addAll = (): void => {
    const account = accountNow();
    if (!account) { say("Link a connection before adding this step."); return; }
    const placed = placeSteps(def, proposals, account, selectedId);
    if ("error" in placed) { say(placed.error); return; }
    onChange(placed.def);
    setLinked(account);
    say(`Added ${placed.nodeIds.length} steps. An outward call waits until you run it.`);
  };

  const addProposal = (proposal: StepProposal): void => {
    const account = accountNow();
    if (!account) { say("Link a connection before adding this step."); return; }
    const placed = linkAccount(def, { account, stepKey: "connector_request", nodeId: selectedId, action: proposal.action });
    if ("error" in placed) { say(placed.error); return; }
    onChange(placed.def);
    setLinked(account);
    say(`Added ${proposal.title}. ${proposal.say}`);
  };

  const openChat = (): void => {
    const message = lines.map((line) => line.say).join("\n");
    onOpenChat(scrubAskContext({ resource: "automation", message }));
  };

  return (
    <View testID="ask-tab" style={s.page}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollInner}>
        {lines.length === 0 ? <Text style={s.copy}>Name an app and what the step should do. A connection already in Vault is linked. A new one is pasted into Vault, and these lines never keep the value.</Text> : null}
        {lines.map((line, i) => <Text key={`${line.who}-${i}`} style={line.who === "you" ? s.you : s.copy}>{line.say}</Text>)}
        {turn?.kind === "use" ? (
          <View style={s.row}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Use ${turn.account.title}`} testID="ask-use" onPress={() => { if (useAccount(turn.account, turn)) say(`Linked ${turn.account.title} to the step.`); }} style={s.btn}><Text style={s.btnText}>Use {turn.account.title}</Text></Pressable>
            {readOffer({ stepKey: turn.stepKey, effect: turn.stepKey === "connector_request" ? (proposals.find((item) => item.action === turn.action)?.effect ?? null) : null, connectionId: turn.account.id, connector: turn.account.app, action: turn.action, input: {} }).kind !== "hold" ? <Pressable accessibilityRole="button" accessibilityLabel="Try this read" testID="ask-try-read" onPress={() => void tryRead({ stepKey: turn.stepKey, effect: turn.stepKey === "connector_request" ? (proposals.find((item) => item.action === turn.action)?.effect ?? null) : null, connectionId: turn.account.id, connector: turn.account.app, action: turn.action, input: {} })} style={s.btn}><Text style={s.btnText}>Try this read</Text></Pressable> : null}
          </View>
        ) : null}
        {turn?.kind === "choose" ? turn.accounts.map((account) => (
          <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`Use ${account.title}`} testID={`ask-pick-${account.id}`} onPress={() => { if (useAccount(account, turn)) say(`Linked ${account.title} to the step.`); }} style={s.btn}><Text style={s.btnText}>{account.title}</Text></Pressable>
        )) : null}
        {turn?.kind === "sign_in" ? <Pressable accessibilityRole="button" accessibilityLabel="Sign in" testID="ask-sign-in" onPress={() => onConnect({ service: turn.service, kind: "connection" })} style={s.btn}><Text style={s.btnText}>Sign in</Text></Pressable> : null}
        {turn?.kind === "paste" ? <PasteBoxes slots={turn.slots} values={values} busy={busy} onChange={(key, value) => setValues((cur) => ({ ...cur, [key]: value }))} onSave={() => void save(turn)} /> : null}
        {proposals.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Add these steps" testID="ask-add-all" onPress={addAll} style={s.btn}><Text style={s.btnText}>Add these steps</Text></Pressable> : null}
        {hooks.map((hook) => (
          <View key={hook.key} testID="ask-webhook">
            <Text style={s.copy}>{hook.say}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Add webhook" testID="ask-add-webhook" onPress={() => { onChange(placeWebhook(def)); say(hook.say); }} style={s.btn}><Text style={s.btnText}>Add webhook</Text></Pressable>
          </View>
        ))}
        {proposals.map((proposal) => (
          <View key={proposal.action} testID={`ask-proposal-${proposal.action}`}>
            <Text style={s.copy}>{proposal.title}. {proposal.say}</Text>
            <View style={s.row}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Add ${proposal.title}`} testID={`ask-add-${proposal.action}`} onPress={() => addProposal(proposal)} style={s.btn}><Text style={s.btnText}>Add {proposal.title}</Text></Pressable>
              {proposal.check === "dry_run" && showTry(proposal.effect) ? <Pressable accessibilityRole="button" accessibilityLabel={`Try ${proposal.title}`} testID={`ask-try-${proposal.action}`} onPress={() => void tryRead({ stepKey: "connector_request", effect: "read", connectionId: accountNow()?.id ?? null, connector: accountNow()?.app ?? null, action: proposal.action, input: {} })} style={s.btn}><Text style={s.btnText}>Try this read</Text></Pressable> : null}
            </View>
          </View>
        ))}
      </ScrollView>
      <TextInput accessibilityLabel="What should this Automation do" testID="ask-input" value={text} onChangeText={setText} placeholder="App and what you want done" placeholderTextColor="var(--ink-4)" style={s.input} />
      <View style={s.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Ask" testID="ask-send" onPress={() => { if (text.trim()) void submit(); }} style={s.btn}><Text style={s.btnText}>Ask</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open in Chats" testID="ask-open-chat" onPress={openChat} style={s.btn}><Text style={s.btnText}>Open in Chats</Text></Pressable>
      </View>
      <Text style={s.hint}>OpenAPI document you already have. A web address is not opened.</Text>
      <TextInput accessibilityLabel="OpenAPI document" testID="ask-doc" value={doc} onChangeText={setDoc} multiline placeholder="Paste the document" placeholderTextColor="var(--ink-4)" style={[s.input, s.doc]} />
      <Pressable accessibilityRole="button" accessibilityLabel="Read this document" testID="ask-read-doc" onPress={() => void readDoc()} style={s.btn}><Text style={s.btnText}>{busy ? "Working" : "Read this document"}</Text></Pressable>
    </View>
  );
}

function PasteBoxes({ slots, values, busy, onChange, onSave }: {
  slots: readonly PasteSlot[];
  values: Readonly<Record<string, string>>;
  busy: boolean;
  onChange(key: string, value: string): void;
  onSave(): void;
}): ReactElement {
  return (
    <View testID="ask-paste" style={s.paste}>
      {slots.map((slot) => (
        <View key={slot.key}>
          <Text style={s.hint}>{slot.label}. {slot.hint}</Text>
          <TextInput
            accessibilityLabel={slot.label}
            testID={`ask-paste-${slot.key}`}
            value={values[slot.key] ?? ""}
            onChangeText={(value) => onChange(slot.key, value)}
            secureTextEntry={slot.secret}
            autoCapitalize="none"
            autoCorrect={false}
            style={s.input}
          />
        </View>
      ))}
      <Pressable accessibilityRole="button" accessibilityLabel="Save in Vault" testID="ask-save" disabled={busy} onPress={onSave} style={s.btn}><Text style={s.btnText}>{busy ? "Saving" : "Save in Vault"}</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 8 },
  scroll: { flex: 1 },
  scrollInner: { gap: 8, paddingBottom: 8 },
  copy: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  you: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  hint: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  row: { flexDirection: "row", gap: 8 },
  paste: { gap: 8 },
  input: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--sunk)" as string },
  doc: { minHeight: 72 },
  btn: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  btnText: { fontSize: 12.5, color: "var(--accent)" as string },
});
