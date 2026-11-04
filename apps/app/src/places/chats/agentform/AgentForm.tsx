// One page to make an agent and to change it, in a main tab (DESIGN-chat-system "New agent"; prototype agentFormH). Face with shuffle and picker, name, what it does, Instructions (AGENT.md, drafted from what it
// does), Context (its `context` folder: start a note and it always knows it), Can reach (one search; a Vault item is a real grant, vault.share at Use), Computer, Who can use it (the Vault's own ShareSheet, hidden in a
// Personal Space) and the Preferred model, which is only a default: a choice in a chat wins.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { each } from "../../../shell/sidebar/model.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConfigDirectory } from "../../automations/config/data.tsx";
import { Overlay } from "../../automations/config/Overlay.tsx";
import { Switch } from "../../automations/config/parts.tsx";
import { shareRows, sheetDirectory } from "../../../share/rows.ts";
import { AccessSheet, accessCount } from "../../../../../../ui/src/AccessSheet/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { MarkdownEditor } from "../../../../../../ui/src/RichEditor/index.tsx";
import { aiMenu } from "../../vault/providers/aiMenu.ts";
import { aiCaption, aiName, automaticLine } from "../../vault/providers/pick.ts";
import { useSpaceAi } from "../../vault/providers/useSpaceAi.ts";
import type { ShareInput, UnshareInput } from "../../../../../../ui/src/AccessSheet/index.tsx";
import { Glyph as Mark } from "../conversation/parts.tsx";
import { Glyph } from "../sidebar/parts.tsx";
import { createInput, draftInstructions, faceChoices, faceSeed, grantsFor, reachOffers, updatePatch, workPatch, chatKeyPatch } from "./model.ts";
import type { AgentDraft, ComputerChoice, VaultItem } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type FileRow = CapMap["files.list"]["out"]["files"][number];

export interface AgentFormProps {
  /** Null makes a new agent. */
  agentId: string | null;
  call: Call;
  newKey(): string;
  /** A note or document kept in `context`: drafted here until the agent exists. */
  onDone(agentId: string): void;
  onCancel(): void;
  say(text: string): void;
  /** Opens Vault > AI accounts, where an admin keeps accounts for this work. */
  openVault?(): void;
  /** Absent in a Personal Space, where nobody else can use it. */
  sharing?: { directory: ConfigDirectory; meName: string; meId: string; nameOf(id: string): string; spaceName?: string };
}

const EMPTY: AgentDraft = { name: "", does: "", face: "", instructions: "", model: "", fallbackModel: "", computer: "none", workKey: "" };
const COMPUTERS: readonly { id: ComputerChoice; title: string; note: string }[] = [
  { id: "none", title: "No computer", note: "Works in chat, files and tools" },
  { id: "own", title: "Its own computer", note: "A browser, terminal and files of its own. Asleep until needed" },
  { id: "yours", title: "Yours, when you ask", note: "Uses your computer only in your own chats" },
];

export function AgentForm({ agentId, call, newKey, onDone, onCancel, say, sharing, openVault }: AgentFormProps): ReactElement {
  const [d, setD] = useState<AgentDraft>(() => ({ ...EMPTY, face: agentId === null ? faceSeed() : "" }));
  const [shares, setShares] = useState<CapMap["access.shares_of"]["out"] | null>(null);
  const [sharingOpen, setSharingOpen] = useState(false);
  const loadShares = useCallback((): void => {
    if (agentId === null) return;
    void Promise.resolve(call("access.shares_of", { resource: { type: "agent", id: agentId } })).then((o) => setShares(o as CapMap["access.shares_of"]["out"]), () => undefined);
  }, [agentId, call]);
  useEffect(loadShares, [loadShares]);
  const [touched, setTouched] = useState(false);
  const [offers, setOffers] = useState<string[]>(() => faceChoices());
  const [items, setItems] = useState<readonly VaultItem[]>([]);
  const [picked, setPicked] = useState<readonly VaultItem[]>([]);
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [files, setFiles] = useState<readonly FileRow[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [models, setModels] = useState<readonly { model: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const spaceAi = useSpaceAi(call);
  const chatOn = d.chatOn === true;
  const aiPop = useMenu();
  // the account the agent was saved with: only a change is sent
  const [savedWork, setSavedWork] = useState("");
  const [savedChat, setSavedChat] = useState("");
  // only people who manage the Space's AI accounts may set the Chat key
  const [mayManageAi, setMayManageAi] = useState(false);
  useEffect(() => { void new Promise<unknown>((r) => r(call("providers.space_key.get", {}))).then((k) => setMayManageAi((k as { mayManage?: boolean } | null)?.mayManage === true), () => undefined); }, [call]);
  const set = (p: Partial<AgentDraft>): void => setD((c) => ({ ...c, ...p }));

  useEffect(() => {
    let live = true;
    void Promise.resolve(call("vault.items.list", {})).then((o) => { if (live) setItems((o as CapMap["vault.items.list"]["out"]).items); }, () => undefined);
    void Promise.resolve(call("engine.models.list", {})).then((o) => { if (live) setModels(((o as { models?: { model: string; title: string; allowed: boolean; reason?: string }[] }).models ?? []).filter((m) => m.allowed || m.reason === "usage_limit")); }, () => undefined);
    if (agentId === null) return () => { live = false; };
    void Promise.resolve(call("agents.get", { agentId })).then(async (o) => {
      const a = (o as CapMap["agents.get"]["out"]).agent;
      if (!live) return;
      setD((c) => ({ ...c, name: a.name, does: a.role ?? "", face: a.face.startsWith("pick-") ? a.face : "", model: a.model ?? "", fallbackModel: a.fallbackModel ?? "", workKey: a.workKey ?? "", chatKey: a.accountPolicy === "key" ? a.accountKey ?? "" : "", chatOn: a.accountPolicy === "key" }));
      setSavedWork(a.workKey ?? "");
      setSavedChat(a.accountPolicy === "key" ? a.accountKey ?? "" : "");
      setFolderId(a.folderId);
      const ls = (await call("files.list", { section: "space", folder: a.folderId, limit: 50 })) as CapMap["files.list"]["out"];
      const md = ls.files.find((f) => f.name === "AGENT.md");
      if (md) { const body = (await call("files.read", { fileId: md.fileId, as: "text", length: 8000 })) as { text?: string }; if (live) { setD((c) => ({ ...c, instructions: body.text ?? "" })); setTouched(true); } }
      const ctx = ls.folders?.find((f) => f.name === "context");
      if (ctx) { const inside = (await call("files.list", { section: "space", folder: ctx.folderId, limit: 50 })) as CapMap["files.list"]["out"]; if (live) setFiles(inside.files); }
    }, () => undefined);
    return () => { live = false; };
  }, [agentId, call]);

  const shown = useMemo(() => (touched ? d.instructions : draftInstructions(d.name, d.does)), [touched, d.instructions, d.name, d.does]);
  const found = useMemo(() => reachOffers(items, q, d.does, picked.map((p) => p.id)), [items, q, d.does, picked]);

  const save = async (): Promise<void> => {
    if (d.name.trim() === "") { say("Name it first."); return; }
    setBusy(true);
    try {
      let id = agentId, folder = folderId;
      if (id === null) {
        const made = (await call("agents.create", createInput(d, newKey()))) as CapMap["agents.create"]["out"];
        id = made.agent.agentId;
        folder = made.agent.folderId;
        // the AI account is not part of agents.create: set it on the new agent
        const work = { ...workPatch(d.workKey, ""), ...(mayManageAi ? chatKeyPatch(chatOn ? d.chatKey : "", "") : {}) };
        if (Object.keys(work).length > 0) await call("agents.update", { agentId: id, patch: work });
      } else await call("agents.update", { agentId: id, patch: { ...updatePatch(d), ...workPatch(d.workKey, savedWork), ...(mayManageAi ? chatKeyPatch(chatOn ? d.chatKey : "", savedChat) : {}) } });
      if (folder) {
        const ls = (await call("files.list", { section: "space", folder, limit: 50 })) as CapMap["files.list"]["out"];
        const md = ls.files.find((f) => f.name === "AGENT.md");
        if (md) await call("files.write", { fileId: md.fileId, content: { text: shown }, reason: "Instructions" });
        else await call("files.create", { folderId: folder, name: "AGENT.md", content: { text: shown }, kind: "markdown", idempotencyKey: newKey() });
        if (notes.length > 0) {
          const ctx = ls.folders?.find((f) => f.name === "context")?.folderId ?? ((await call("files.folder.create", { parentId: folder, name: "context", idempotencyKey: newKey() })) as { folder: { folderId: string } }).folder.folderId;
          for (const [i, text] of notes.entries()) await call("files.create", { folderId: ctx, name: `note-${files.length + i + 1}.md`, content: { text }, kind: "markdown", idempotencyKey: newKey() });
        }
      }
      for (const item of grantsFor(picked)) await call("vault.share", { resource: { type: "vault_item", id: item.id }, subject: { kind: "agent", id }, level: "use", idempotencyKey: newKey() });
      onDone(id);
    } catch { say("Could not save the agent. Try again."); } finally { setBusy(false); }
  };

  return (
    <ScrollView testID="agent-form" style={st.root} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
      <View style={st.col}>
        <View style={st.head}>
          <View>
            <Avatar name={d.name || "Agent"} seedId={d.face || agentId || ""} kind="agent" size={72} />
            <Pressable role="button" aria-label="Shuffle the face" testID="agent-shuffle" onPress={() => { set({ face: faceSeed() }); setOffers(faceChoices()); }} style={st.shuffle}><Glyph name="retry" size={13} color="var(--ink-2)" /></Pressable>
          </View>
          <View style={st.names}>
            <TextInput testID="agent-name" accessibilityLabel="Name" value={d.name} onChangeText={(name) => set({ name })} placeholder="Name" placeholderTextColor="var(--ink-4)" style={st.name} />
            <TextInput testID="agent-does" accessibilityLabel="What does it do?" value={d.does} onChangeText={(does) => set({ does })} placeholder="What does it do?" placeholderTextColor="var(--ink-4)" style={st.does} />
          </View>
        </View>
        <View style={st.picks}>
          {each(offers, (seed) => <Pressable key={seed} role="button" aria-label="Use this face" testID={`agent-face-${seed}`} onPress={() => set({ face: seed })} style={[st.pick, d.face === seed && st.pickOn]}><Avatar name="Agent" seedId={seed} kind="agent" size={32} /></Pressable>)}
        </View>

        <Section title="Instructions" note="AGENT.md">
          <View style={st.md}><MarkdownEditor testID="agent-instructions" label="Instructions" value={shown} onChange={(instructions) => { setTouched(true); set({ instructions }); }} minHeight={260} /></View>
        </Section>

        <Section title="Context" note="It always knows these">
          <View style={st.drop}>
            {each(files, (f) => <View key={f.fileId} style={st.file}><Text numberOfLines={1} style={st.fileText}>{f.name}</Text></View>)}
            {each(notes, (n, i) => <View key={i} style={st.file}><Text numberOfLines={1} style={st.fileText}>{n.split("\n")[0]}</Text><Pressable role="button" aria-label="Remove this note" onPress={() => setNotes((l) => l.filter((_, x) => x !== i))}><Mark name="x" size={11} /></Pressable></View>)}
            {note === null ? <Pressable role="button" testID="agent-note" onPress={() => setNote("")} style={st.addNote}><Text style={st.addNoteText}>Start a note</Text></Pressable> : null}
          </View>
          {note !== null ? (
            <View style={st.noteBox}>
              <View style={st.md}><MarkdownEditor testID="agent-note-text" label="The note" autoFocus value={note} onChange={setNote} placeholder="What should it always know?" toggle={false} minHeight={90} density="compact" /></View>
              <View style={st.row}>
                <Btn label="Keep" primary testID="agent-note-keep" onPress={() => { if (note.trim() !== "") setNotes((l) => [...l, note.trim()]); setNote(null); }} />
                <Btn label="Cancel" testID="agent-note-cancel" onPress={() => setNote(null)} />
              </View>
            </View>
          ) : null}
        </Section>

        <Section title="Can reach" note={picked.length === 0 ? "Nothing yet" : `${picked.length} from the Vault`}>
          {each(picked, (p) => <View key={p.id} style={st.line}><Text style={st.lineText}>{p.name}</Text><Btn label="Remove" testID={`agent-reach-off-${p.id}`} onPress={() => setPicked((l) => l.filter((x) => x.id !== p.id))} /></View>)}
          <TextInput testID="agent-reach" accessibilityLabel="Search what it can reach" value={q} onChangeText={setQ} placeholder="Search the Vault" placeholderTextColor="var(--ink-3)" style={st.field} />
          {each(found, (i) => <Pressable key={i.id} role="button" testID={`agent-reach-${i.id}`} onPress={() => { setPicked((l) => [...l, i]); setQ(""); }} style={(({ hovered }: { hovered?: boolean }) => [st.line, hovered === true && st.over]) as never}><Text style={st.lineText}>{i.name}</Text><Text style={st.lineNote}>Use</Text></Pressable>)}
        </Section>

        <Section title="Computer">
          {each(COMPUTERS, (c) => (
            <Pressable key={c.id} role="radio" aria-checked={d.computer === c.id} testID={`agent-computer-${c.id}`} onPress={() => set({ computer: c.id })} style={st.opt}>
              <View style={[st.radio, d.computer === c.id && st.radioOn]} />
              <View style={st.optText}><Text style={st.lineText}>{c.title}</Text><Text style={st.lineNote}>{c.note}</Text></View>
            </Pressable>
          ))}
        </Section>

        {sharing ? (
          <Section title="Who can use it" note={agentId === null ? "Only you, until you share it" : `${shares && sharing ? accessCount({ shares: shareRows(shares, sharing.nameOf, agentId), itemType: "agent", resourceId: agentId, ownerId: sharing.meId, ownerName: sharing.meName }) : 1} with access`}>
            <View style={st.row}><Btn label="Share" testID="agent-share" onPress={() => { if (agentId === null) say("Create it first, then share it from here."); else setSharingOpen(true); }} /></View>
          </Section>
        ) : null}

        {sharing ? (
          <Section title="AI account">
            <Pressable
              role="button" aria-haspopup="menu" aria-label={`AI account: ${aiName(spaceAi ?? [], d.workKey)}. Change`} testID="agent-ai-account"
              onPress={(e) => {
                const r = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
                aiPop.show(aiMenu(spaceAi ?? [], "agentWork", d.workKey || undefined, (h) => set({ workKey: h ?? "" }), { ...(agentId ? { agentId } : {}), ...(openVault ? { openVault } : {}) }), r?.left ?? 0, (r?.bottom ?? 0) + 4, "other");
              }}
              style={st.kv}
            >
              <Text style={st.lineText}>{aiName(spaceAi ?? [], d.workKey)}</Text>
              <Text style={st.lineNote}>{aiCaption(d.workKey || undefined, spaceAi ?? [])}</Text>
            </Pressable>
            <Text testID="agent-ai-note" style={st.hint}>Pays for its own work: routines, watchers and helpers that run with nobody asking. Automatic uses a Space AI account the rules allow for this agent, the cheapest that fits. In a chat, the person's own account comes first.</Text>
            {!d.workKey && spaceAi ? <Text testID="agent-ai-today" style={st.hint}>{automaticLine(spaceAi, "agentWork", agentId ?? undefined)}</Text> : null}
            <Text accessibilityRole="header" style={[st.secTitle, { marginTop: 18 }]}>Chat key</Text>
            <View style={st.switchRow}>
              <View style={st.optText}>
                <Text style={st.lineText}>Pay for chats with this account instead of each person's own</Text>
                <Text testID="agent-chat-key-state" style={st.lineNote}>{chatOn ? "On. Every chat with this agent is paid by the account below." : mayManageAi ? "Off. In a chat the person's own account comes first." : "Off. Only people who manage the Space's AI accounts can turn this on."}</Text>
              </View>
              <Switch on={chatOn} label="Pay for chats with this account instead of each person's own" disabled={!mayManageAi} testID="agent-chat-key" onChange={(next) => set(next ? { chatOn: true } : { chatOn: false, chatKey: "" })} />
            </View>
            {chatOn ? (
              <Pressable
                role="button" aria-haspopup="menu" aria-label={`Chat key account: ${(d.chatKey ?? "") === "" ? "choose one" : aiName(spaceAi ?? [], d.chatKey)}. Change`} testID="agent-chat-key-account" disabled={!mayManageAi}
                onPress={(e) => {
                  const r = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
                  aiPop.show(aiMenu(spaceAi ?? [], "chats", d.chatKey || undefined, (h) => set({ chatKey: h ?? "" }), { none: "Choose an account", ...(openVault ? { openVault } : {}) }), r?.left ?? 0, (r?.bottom ?? 0) + 4, "other");
                }}
                style={[st.kv, { marginTop: 8 }]}
              >
                <Text style={st.lineText}>{(d.chatKey ?? "") === "" ? "Choose an account" : aiName(spaceAi ?? [], d.chatKey)}</Text>
                <Text style={st.lineNote}>Space AI account</Text>
              </Pressable>
            ) : null}
          </Section>
        ) : null}

        <Section title="Preferred model" note="Only a default: a choice in a chat wins">
          <View style={st.row}>
            <Pressable role="radio" aria-checked={d.model === ""} testID="agent-model-auto" onPress={() => set({ model: "" })} style={[st.chip, d.model === "" && st.chipOn]}><Text style={st.chipText}>Whatever you have</Text></Pressable>
            {each(models.slice(0, 8), (m) => <Pressable key={m.model} role="radio" aria-checked={d.model === m.model} testID={`agent-model-${m.model}`} onPress={() => set({ model: m.model })} style={[st.chip, d.model === m.model && st.chipOn]}><Text style={st.chipText}>{m.title}</Text></Pressable>)}
          </View>
        </Section>

        <View style={st.foot}>
          <Btn label={agentId === null ? "Create agent" : "Save"} primary testID="agent-save" onPress={() => { if (!busy) void save(); }} />
          <Btn label="Cancel" testID="agent-cancel" onPress={onCancel} />
        </View>
      </View>
      {aiPop.element}
      {sharing && sharingOpen && agentId !== null && shares ? (
        <Overlay label="Who can use it" onClose={() => setSharingOpen(false)} testID="agent-share-overlay">
          <AccessSheet
            mode="share" itemType="agent" resourceType="agent" resourceId={agentId} itemName={d.name} target="item" ownerName={sharing.meName} ownerId={sharing.meId} {...(sharing.spaceName ? { spaceName: sharing.spaceName } : {})} levels={["view", "use", "edit", "manage"]}
            shares={shareRows(shares, sharing.nameOf, agentId)} allowExternal={false} density="compact" newKey={newKey}
            {...(shares.agentsCanCall === undefined ? {} : { agentsOn: shares.agentsCanCall })}
            onAgents={(on) => { void Promise.resolve(call("access.agents_can_call.set", { agentId, on, idempotencyKey: newKey() })).then(loadShares, () => say("Could not change who can call this agent.")); }}
            directory={sheetDirectory(sharing.directory)}
            onShare={(i: ShareInput) => { void Promise.resolve(call("access.share", i)).then(loadShares, () => say("Could not change access.")); }}
            onUnshare={(i: UnshareInput) => { void Promise.resolve(call("access.unshare", i)).then(loadShares, () => say("Could not change access.")); }}
            onClose={() => setSharingOpen(false)}
          />
        </Overlay>
      ) : null}
    </ScrollView>
  );
}


function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }): ReactElement {
  return <View style={st.sec}><View style={st.secHead}><Text accessibilityRole="header" style={st.secTitle}>{title}</Text>{note ? <Text style={st.secNote}>{note}</Text> : null}</View>{children}</View>;
}

function Btn({ label, primary = false, testID, onPress }: { label: string; primary?: boolean; testID: string; onPress(): void }): ReactElement {
  return <Pressable role="button" testID={testID} onPress={onPress} style={[st.btn, primary && st.btnP]}><Text style={[st.btnText, primary && st.btnTextP]}>{label}</Text></Pressable>;
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  content: { alignItems: "center", paddingHorizontal: 20, paddingTop: 34, paddingBottom: 60 },
  col: { width: "100%", maxWidth: 620 },
  head: { flexDirection: "row", alignItems: "center", gap: 18 },
  shuffle: { position: "absolute", right: -6, bottom: -6, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" } as object,
  names: { flex: 1, minWidth: 0 },
  name: { fontSize: 26, fontWeight: "600", letterSpacing: -0.4, color: "var(--ink)" as string, padding: 0, outlineStyle: "none", outlineWidth: 0 } as object,
  does: { marginTop: 4, fontSize: 15, color: "var(--ink-2)" as string, padding: 0, outlineStyle: "none", outlineWidth: 0 } as object,
  picks: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 14 },
  pick: { padding: 2, borderRadius: 12 },
  pickOn: { boxShadow: "0 0 0 2px var(--accent)" } as object,
  sec: { paddingTop: 26 },
  secHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  secTitle: { fontSize: 13, fontWeight: "600", color: "var(--ink-2)" as string },
  secNote: { fontSize: 12.5, color: "var(--ink-3)" as string },
  text: { minHeight: 120, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 21, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  tall: { height: 190 },
  md: { borderRadius: 12, backgroundColor: "var(--field)" as string, overflow: "hidden" },
  field: { height: 34, borderRadius: 9, paddingHorizontal: 11, marginTop: 4, fontSize: 14, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  drop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, padding: 10, borderRadius: 14, boxShadow: "inset 0 0 0 1.5px var(--line-2)" } as object,
  file: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, maxWidth: 220, paddingHorizontal: 10, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  fileText: { flexShrink: 1, fontSize: 13, color: "var(--ink)" as string },
  addNote: { height: 30, paddingHorizontal: 9, justifyContent: "center" },
  addNoteText: { fontSize: 12.5, color: "var(--accent)" as string },
  noteBox: { marginTop: 8, gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10 },
  over: { backgroundColor: "var(--hover)" as string },
  lineText: { fontSize: 14, color: "var(--ink)" as string },
  lineNote: { fontSize: 12.5, color: "var(--ink-3)" as string },
  kv: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 40, paddingHorizontal: 12, borderRadius: 11, backgroundColor: "var(--sunk)" as string },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingVertical: 8 },
  hint: { marginTop: 6, fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  opt: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 8 },
  optText: { flex: 1, gap: 1 },
  radio: { width: 16, height: 16, borderRadius: 8, boxShadow: "inset 0 0 0 1.5px var(--line-2)" } as object,
  radioOn: { boxShadow: "inset 0 0 0 5px var(--accent)" } as object,
  chip: { height: 30, paddingHorizontal: 11, borderRadius: 10, justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  chipOn: { backgroundColor: "var(--accent-wash)" as string },
  chipText: { fontSize: 13, color: "var(--ink-2)" as string },
  foot: { flexDirection: "row", gap: 6, paddingTop: 30 },
  btn: { height: 30, paddingHorizontal: 11, borderRadius: 11, justifyContent: "center" },
  btnP: { paddingHorizontal: 13, backgroundColor: "var(--accent)" as string },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink-3)" as string },
  btnTextP: { fontWeight: "600", color: "var(--accent-ink)" as string },
});
