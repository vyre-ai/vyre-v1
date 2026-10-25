// Two cards that sit in a conversation as the prototype draws them (spec 3.2, 2.6, 4.13): an agent's proposed change to its own AGENT.md, shown inline as the diff with Accept, Edit and
// Reject (never a collapsed card), and the plan document an agent wrote, a compact file card that opens beside the chat. The proposal is a changeset block that carries its hunks;
// Accept and Reject are the changeset capabilities, so the same press works from the diff tab. A person who may not accept sees "Suggest to <owner>" instead.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Block } from "../../../../../../ui/src/kit/types.ts";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { BlockHost } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import { Glyph, TextButton } from "./parts.tsx";
import { collect } from "./model.ts";

export interface Hunk { sec: string; del: string; add: string }

export interface ProposalData {
  changesetId: string;
  file: string;
  agent: string;
  why: string;
  hunks: Hunk[];
  state: "open" | "accepted" | "rejected" | "sent";
  lines: number;
  owner: string;
  canAccept: boolean;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** An agent-file proposal is a changeset block with hunks. Any other changeset is the shared changeset card. */
export function isProposal(b: { type: string; data: unknown }): boolean {
  return b.type === "changeset" && isRec(b.data) && Array.isArray(b.data.hunks);
}

export function proposalData(data: unknown): ProposalData {
  const d = isRec(data) ? data : {};
  const hunks = collect((Array.isArray(d.hunks) ? d.hunks : []).filter(isRec), (h): Hunk => ({ sec: str(h.sec), del: str(h.del), add: str(h.add) }));
  const state = d.state === "accepted" || d.state === "rejected" || d.state === "sent" ? d.state : "open";
  return { changesetId: str(d.changesetId), file: str(d.file) || "AGENT.md", agent: str(d.agent), why: str(d.why), hunks, state, lines: typeof d.lines === "number" ? d.lines : 0, owner: str(d.owner), canAccept: d.canAccept !== false };
}

/** "1 change" / "2 changes". */
export const changeCount = (n: number): string => `${n} ${n === 1 ? "change" : "changes"}`;

/** The note an edited proposal sends back to the agent: the added lines the person wants instead. */
export function editedNote(file: string, lines: readonly string[]): string {
  return `Use these lines in ${file} instead:\n${lines.join("\n")}`;
}

let keys = 0;
const newKey = (id: string, verb: string): string => `idem_${id}_${verb}_${++keys}`;

/** The presses of the card, over the host: Accept and Reject are the changeset capabilities; an edit or a suggestion goes back to the agent as a request for changes. */
export function proposalActs(host: BlockHost, d: ProposalData, id: string): { accept(): Promise<unknown>; reject(): Promise<unknown>; sendEdited(lines: readonly string[]): Promise<unknown>; suggest(): Promise<unknown> } {
  return {
    accept: async () => host.invoke("changesets.approve", { changesetId: d.changesetId, idempotencyKey: newKey(id, "approve") }),
    reject: async () => host.invoke("changesets.discard", { changesetId: d.changesetId }),
    sendEdited: async (lines) => host.invoke("changesets.request_changes", { changesetId: d.changesetId, note: editedNote(d.file, lines.filter((l) => l.trim() !== "")) }),
    suggest: async () => host.invoke("changesets.request_changes", { changesetId: d.changesetId, note: `Suggested to ${d.owner || "the owner"}: ${d.why}` }),
  };
}

export function AgentFileProposal({ block, host }: { block: Block; host: BlockHost }): ReactElement {
  const d = proposalData(block.data);
  const [state, setState] = useState<ProposalData["state"]>(d.state);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(collect(d.hunks, (h) => h.add).join("\n"));
  const { element, show } = useMenu();
  const id = block.id;
  const open = (): void => host.open("file", { path: d.file, agent: d.agent });
  const acts = proposalActs(host, d, id);
  const accept = (): void => { setState("accepted"); void acts.accept(); };
  const reject = (): void => { setState("rejected"); void acts.reject(); };
  const sendEdited = (): void => { setState("sent"); setEditing(false); void acts.sendEdited(text.split("\n")); };
  const suggest = (): void => { setState("sent"); void acts.suggest(); };

  if (state !== "open") {
    const line = state === "accepted" ? `You accepted the change to ${d.file}.${d.lines > 0 ? ` It has ${d.lines} lines now.` : ""}` : state === "rejected" ? `You rejected the change to ${d.file}.` : `Sent your edit to ${d.agent || "the agent"}. It will propose the change again.`;
    return (
      <View testID={`proposal-${id}`} accessibilityLabel={`${d.file} change, ${state}`} style={[st.card, st.done]}>
        <Glyph name={state === "rejected" ? "x" : "check"} size={13} color={state === "rejected" ? "var(--ink-3)" : "var(--ok)"} />
        <Text testID={`proposal-${id}-state`} style={st.doneText}>{line}</Text>
      </View>
    );
  }
  const menu = (x: number, y: number): void => {
    show([
      ...(d.canAccept ? [{ label: "Accept", onSelect: accept }, { label: "Edit…", onSelect: () => setEditing(true) }] : [{ label: `Suggest to ${d.owner || "the Owner"}`, onSelect: suggest }]),
      { label: "Reject", onSelect: reject },
      { separator: true as const },
      { label: `Open ${d.file}`, onSelect: open },
    ], x, y, "context", { label: `${d.file} change` });
  };
  return (
    <View testID={`proposal-${id}`} accessibilityLabel={`${d.file} change proposed by ${d.agent}`} {...menuTrigger(menu)} style={st.card}>
      <View style={st.head}>
        <Glyph name="file" size={15} color="var(--ink-3)" />
        <View style={st.headTitle}>
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${d.file}`} testID={`proposal-${id}-open`} onPress={open}><Text style={st.link}>{d.file}</Text></Pressable>
          <Text style={st.faint}>{` · proposed by ${d.agent}`}</Text>
        </View>
        <Text style={st.faint}>{changeCount(d.hunks.length)}</Text>
      </View>
      <Text testID={`proposal-${id}-why`} style={st.why}>{d.why}</Text>
      {editing ? (
        <TextInput testID={`proposal-${id}-edit`} accessibilityLabel="Edit the added lines" multiline numberOfLines={d.hunks.length * 2 + 1} value={text} onChangeText={setText} style={st.edit} />
      ) : (
        <View testID={`proposal-${id}-diff`} style={st.diff}>
          {collect(d.hunks, (h, i) => (
            <View key={i}>
              {h.sec ? <Text style={[st.line, st.ctx]}>{h.sec}</Text> : null}
              {h.del ? <View style={st.lineRow}><View testID="diff-del" pointerEvents="none" style={[st.wash, { backgroundColor: "var(--danger)" as string, opacity: 0.13 }]} /><Text style={st.sign}>{"−"}</Text><Text style={[st.line, { color: "var(--ink-2)" as string }]}>{h.del}</Text></View> : null}
              <View style={st.lineRow}><View testID="diff-add" pointerEvents="none" style={[st.wash, { backgroundColor: "var(--ok)" as string, opacity: 0.16 }]} /><Text style={st.sign}>+</Text><Text style={st.line}>{h.add}</Text></View>
            </View>
          ))}
        </View>
      )}
      <View style={st.foot}>
        {editing ? (
          <>
            <TextButton label="Send Edited" dark icon="check" testID={`proposal-${id}-send`} onPress={sendEdited} />
            <TextButton label="Cancel" testID={`proposal-${id}-cancel`} onPress={() => setEditing(false)} />
          </>
        ) : d.canAccept ? (
          <>
            <TextButton label="Accept" dark icon="check" testID={`proposal-${id}-accept`} onPress={accept} />
            <TextButton label="Edit" ring icon="edit" testID={`proposal-${id}-edit-open`} onPress={() => setEditing(true)} />
            <TextButton label="Reject" icon="x" testID={`proposal-${id}-reject`} onPress={reject} />
          </>
        ) : (
          <>
            <TextButton label={`Suggest to ${d.owner || "the Owner"}`} dark icon="check" testID={`proposal-${id}-suggest`} onPress={suggest} />
            <TextButton label="Reject" icon="x" testID={`proposal-${id}-reject`} onPress={reject} />
          </>
        )}
      </View>
      {element}
    </View>
  );
}

export interface PlanFileData { fileId: string; name: string; openComments: number }

export function planFileData(b: { id: string; data: unknown }): PlanFileData {
  const d = isRec(b.data) ? b.data : {};
  return { fileId: str(d.id) || b.id, name: str(d.name) || str(d.title) || "Plan", openComments: typeof d.openComments === "number" ? d.openComments : 0 };
}

/** The plan document card: "Plan · 1 open comment · click to open beside the chat". */
export const isPlanFile = (b: { type: string; data: unknown }): boolean => b.type === "file" && isRec(b.data) && b.data.kind === "plan";

export const planFileLine = (n: number): string => `Plan · ${n} open comment${n === 1 ? "" : "s"} · click to open beside the chat`;

export function PlanFileCard({ block, onOpen }: { block: { id: string; data: unknown }; onOpen: (fileId: string) => void }): ReactElement {
  const d = planFileData(block);
  const [over, setOver] = useState(false);
  return (
    <Pressable
      testID={`plancard-${block.id}`} accessibilityRole="button" accessibilityLabel={`Open ${d.name} beside the chat`} onPress={() => onOpen(d.fileId)}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[st.plan, over && { backgroundColor: "var(--hover)" as string }]}
    >
      <View style={st.planIcon}><Glyph name="plan" size={16} color="var(--accent)" /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={st.planName}>{d.name}</Text>
        <Text numberOfLines={1} style={st.planSub}>{planFileLine(d.openComments)}</Text>
      </View>
    </Pressable>
  );
}

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const RING = { boxShadow: "inset 0 0 0 1px var(--line-2)" } as object;

const st = StyleSheet.create({
  card: { marginTop: 8, marginBottom: 6, maxWidth: 520, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 10, ...RING },
  done: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  doneText: { flex: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headTitle: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  link: { fontSize: 13, color: "var(--accent)" as string },
  faint: { fontSize: 12, color: "var(--ink-3)" as string },
  why: { fontSize: 13, lineHeight: 20, color: "var(--ink-2)" as string },
  diff: { borderRadius: 10, paddingVertical: 6, overflow: "hidden", backgroundColor: "var(--win)" as string, ...RING },
  lineRow: { flexDirection: "row", paddingHorizontal: 10, position: "relative" },
  wash: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  sign: { width: 14, fontFamily: MONO, fontSize: 12, lineHeight: 18, color: "var(--ink-3)" as string },
  line: { flex: 1, fontFamily: MONO, fontSize: 12, lineHeight: 18, color: "var(--ink)" as string, paddingHorizontal: 0 },
  ctx: { paddingHorizontal: 10, color: "var(--ink-4)" as string },
  edit: { minHeight: 70, borderRadius: 10, padding: 10, fontFamily: MONO, fontSize: 12, lineHeight: 18, color: "var(--ink)" as string, backgroundColor: "var(--sunk)" as string, outlineStyle: "none" } as object,
  foot: { flexDirection: "row", alignItems: "center", gap: 6 },
  plan: { flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "flex-start", maxWidth: 460, marginTop: 6, marginBottom: 8, paddingVertical: 10, paddingRight: 14, paddingLeft: 10, borderRadius: 12, ...RING },
  planIcon: { width: 34, height: 40, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  planName: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  planSub: { fontSize: 12, color: "var(--ink-3)" as string },
});
