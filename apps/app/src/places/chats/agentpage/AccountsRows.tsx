// Agent page > Settings > AI accounts (memory ruling 6): the chat key, the ordered fallback list and the Memory key, each picked from the accounts the person can use (their own and the shared Vault
// AI providers). A press on a row opens the picker as a menu (arrows, Enter, Escape; the account in use is checked); the fallback list is ordered, so each entry has Up, Down and Remove, and
// "Add a fallback" lists what is left. Without Edit the rows read the same and change nothing. Every change says what it did and offers Undo.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Icon, LeadIcon } from "../rightpane/parts.tsx";
import type { Entry } from "../rightpane/parts.tsx";
import { setAccounts } from "./actions.ts";
import type { AccountPatch, PageDeps } from "./actions.ts";
import { STATUS_NOTE, accountName, accountOptions, chatKeyNote, memoryKeyNote, moveRef } from "./model.ts";
import type { AccountChoice, AgentRow } from "./model.ts";

const menuAt = (e: unknown): { x: number; y: number } => {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const r = ev?.currentTarget?.getBoundingClientRect?.();
  return { x: r?.left ?? ev?.nativeEvent?.pageX ?? 200, y: (r?.bottom ?? ev?.nativeEvent?.pageY ?? 0) + 4 };
};

/** A small icon button with a hover fill, a label for readers and a visible focus ring (the row's own press is a different target). */
function Tool({ icon, label, onPress, disabled = false, flip = false, testID }: { icon: string; label: string; onPress: () => void; disabled?: boolean; flip?: boolean; testID: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} testID={testID} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[st.tool, over && !disabled && { backgroundColor: "var(--hover)" as string }, disabled && { opacity: 0.35 }]}
    ><View style={flip ? { transform: [{ rotate: "180deg" }] } : undefined}><Icon name={icon} size={14} /></View></Pressable>
  );
}

export interface AccountsInput { agent: AgentRow; deps: PageDeps; accounts: readonly AccountChoice[]; canEdit: boolean }

/** The entries of the AI accounts section, and the menu element the page must render beside the list. */
export function useAccountEntries({ agent, deps, accounts, canEdit }: AccountsInput): { entries: Entry[]; element: ReactElement } {
  const menu = useMenu();
  const fallback = agent.accountFallback ?? [];
  const chat = agent.accountPolicy === "key" ? agent.accountKey ?? null : null;
  const before: AccountPatch = { accountPolicy: agent.accountPolicy, accountKey: agent.accountKey ?? null, accountFallback: [...fallback], memoryKey: agent.memoryKey ?? null };
  const save = (patch: AccountPatch, said: string): void => { void setAccounts(deps, agent.agentId, patch, before, said); };
  const label = (a: AccountChoice): string => `${accountName(accounts, a.ref)}${STATUS_NOTE[a.status] ? `, ${STATUS_NOTE[a.status].toLowerCase()}` : ""}`;

  const pick = (e: unknown, current: string | null, none: string, choose: (ref: string | null) => void, taken: readonly string[] = []): void => {
    const { x, y } = menuAt(e);
    const items: MenuEntry[] = [];
    if (none !== "") items.push({ label: none, checked: current === null, onSelect: () => choose(null) });
    for (const a of accountOptions(accounts, taken)) items.push({ label: label(a), checked: a.ref === current, onSelect: () => choose(a.ref) });
    if (items.length === 0) items.push({ label: "No accounts to pick. Add one in the Vault.", disabled: true });
    menu.show(items, x, y, "other");
  };

  const entries: Entry[] = [];
  entries.push({ key: "l-accounts", type: "label", text: "AI accounts" });
  entries.push({
    key: "acct-chat", type: "row", title: "Chat key", note: chatKeyNote(agent, accounts), leading: <LeadIcon name="lock" />, testID: "setting-chat-key",
    ...(canEdit ? { onPress: () => undefined, trailing: (
      <Pressable accessibilityRole="button" accessibilityLabel={`Chat key: ${chat ? accountName(accounts, chat) : "whoever asks"}. Change`} testID="pick-chat-key" onPress={(e) => pick(e, chat, "Whoever asks (their own account)", (ref) =>
        save(ref ? { accountPolicy: "key", accountKey: ref } : { accountPolicy: "asker", accountKey: null }, ref ? `${agent.name} now runs on ${accountName(accounts, ref)}.` : `${agent.name} runs on the account of whoever asks again.`))} style={st.pick}>
        <Text numberOfLines={1} style={st.pickText}>{chat ? accountName(accounts, chat) : "Whoever asks"}</Text><Icon name="chev" size={12} />
      </Pressable>) } : {}),
  });
  fallback.forEach((ref, i) => {
    entries.push({
      key: `acct-fb-${ref}`, type: "row", title: `${i + 1}. ${accountName(accounts, ref)}`, note: i === 0 ? "Tried first if the chat key fails" : "Tried next", testID: `fallback-${i}`,
      trailing: canEdit ? (
        <View style={st.tools}>
          <Tool icon="chev" flip label={`Move ${accountName(accounts, ref)} up`} disabled={i === 0} testID={`fallback-up-${i}`} onPress={() => save({ accountFallback: moveRef(fallback, i, -1) }, `${accountName(accounts, ref)} moved up.`)} />
          <Tool icon="chev" label={`Move ${accountName(accounts, ref)} down`} disabled={i === fallback.length - 1} testID={`fallback-down-${i}`} onPress={() => save({ accountFallback: moveRef(fallback, i, 1) }, `${accountName(accounts, ref)} moved down.`)} />
          <Tool icon="x" label={`Remove ${accountName(accounts, ref)}`} testID={`fallback-remove-${i}`} onPress={() => save({ accountFallback: fallback.filter((x) => x !== ref) }, `${accountName(accounts, ref)} removed from the fallbacks.`)} />
        </View>
      ) : undefined,
    });
  });
  if (fallback.length === 0) entries.push({ key: "acct-fb-none", type: "empty", text: "No fallback keys. When the chat key fails the Space backups are tried.", testID: "fallback-empty" });
  if (canEdit) {
    entries.push({
      key: "acct-fb-add", type: "row", title: "Add a fallback", note: "Tried in the order listed, then the Space backups, then Needs you", leading: <LeadIcon name="plus" />, testID: "fallback-add",
      onPress: () => undefined,
      trailing: (
        <Pressable accessibilityRole="button" accessibilityLabel="Add a fallback key" testID="pick-fallback" onPress={(e) => pick(e, null, "", (ref) => { if (ref) save({ accountFallback: [...fallback, ref] }, `${accountName(accounts, ref)} added to the fallbacks.`); }, [...fallback, ...(chat ? [chat] : [])])} style={st.pick}>
          <Text style={st.pickText}>Add</Text><Icon name="chev" size={12} />
        </Pressable>
      ),
    });
  }
  entries.push({
    key: "acct-memory", type: "row", title: "Memory key", note: memoryKeyNote(agent, accounts), leading: <LeadIcon name="lock" />, testID: "setting-memory-key",
    ...(canEdit ? { onPress: () => undefined, trailing: (
      <Pressable accessibilityRole="button" accessibilityLabel={`Memory key: ${agent.memoryKey ? accountName(accounts, agent.memoryKey) : "the Space key"}. Change`} testID="pick-memory-key" onPress={(e) => pick(e, agent.memoryKey ?? null, "The Space memory key", (ref) =>
        save({ memoryKey: ref }, ref ? `${accountName(accounts, ref)} now pays for ${agent.name}'s memory upkeep.` : `${agent.name}'s memory upkeep uses the Space key again.`))} style={st.pick}>
        <Text numberOfLines={1} style={st.pickText}>{agent.memoryKey ? accountName(accounts, agent.memoryKey) : "Space key"}</Text><Icon name="chev" size={12} />
      </Pressable>) } : {}),
  });
  return { entries, element: menu.element };
}

const st = StyleSheet.create({
  pick: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 220, minHeight: 26, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string },
  pickText: { fontSize: 12.5, color: "var(--ink-2)" as string, flexShrink: 1 },
  tools: { flexDirection: "row", alignItems: "center", gap: 2 },
  tool: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
});
