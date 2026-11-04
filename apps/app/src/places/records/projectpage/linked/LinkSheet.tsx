// "Link something": one sheet. Search Vyre (records, files, chats, tasks the person may read) or paste an address (a GitHub pull request or commit by its name, any other web address as itself). A link is live: it always
// shows the current state of the original, never a copy.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../../../../ui/src/TextField/index.tsx";
import { useProjectPageData } from "../data.tsx";
import { KIND_WORD, linkOfHit, parseAddress } from "./model.ts";
import type { Link, LinkKind } from "./model.ts";

type Hit = { kind: string; id: string; title: string; recordType?: string | undefined };
interface Cand { key: string; kind: LinkKind; ref: string; label: string }

export interface LinkSheetProps {
  projectId: string;
  projectTitle: string;
  /** What is already linked, so it is not offered again. */
  have: readonly Link[];
  onClose(): void;
  onLinked(text: string, undo: () => Promise<void>): void;
}

export function LinkSheet({ projectId, have, onClose, onLinked }: LinkSheetProps): ReactElement {
  const d = useProjectPageData();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<readonly Hit[] | null>(null);
  const [url, setUrl] = useState("");
  const [line, setLine] = useState("");
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const text = q.trim();
    const types = ["record", "file", "chat", "task"];
    // before anything is typed, what the person opened or edited lately
    void Promise.resolve(text === "" ? d.call("search.recent.list", { types, limit: 8 }) : d.call("search.query", { q: text, types, limit: 8 })).then(
      (o) => { if (live) setHits((o as { hits: Hit[] }).hits); },
      () => { if (live) setHits([]); },
    );
    return () => { live = false; };
  }, [d, q]);

  const taken = new Set([...have.map((l) => `${l.kind}:${l.ref}`), ...done]);
  const cands: Cand[] = [];
  for (const h of hits ?? []) {
    const c = linkOfHit(h);
    if (c !== null && !taken.has(`${c.kind}:${c.ref}`)) cands.push({ key: `${c.kind}:${c.ref}`, ...c });
  }

  const link = async (kind: LinkKind, ref: string, label: string, extra: { url?: string } = {}): Promise<boolean> => {
    setBusy(true);
    try {
      await d.call("projects.links.link", { projectId, kind, ref, label, ...extra });
      setDone((s) => new Set(s).add(`${kind}:${ref}`));
      onLinked(`Linked ${label}`, async () => { await d.call("projects.links.unlink", { projectId, kind, ref }); });
      return true;
    } catch (e) { setLine(e instanceof Error && e.message ? e.message : "That could not be linked."); return false; } finally { setBusy(false); }
  };

  const paste = async (): Promise<void> => {
    if (url.trim() === "") { setLine("Paste a link first."); return; }
    const p = parseAddress(url);
    if (p === null) { setLine("That does not look like a link."); return; }
    if (await link(p.kind, p.ref, p.label ?? p.ref, { url: p.url })) {
      setLine(p.kind === "url" ? "Linked as a web link." : `Linked ${KIND_WORD[p.kind]}. It shows live state when GitHub is connected.`);
      setUrl("");
    }
  };

  return (
    <Dialog title="Link something" onClose={onClose} width={520} testID="link-sheet" actions={[{ label: "Done", primary: true, onPress: onClose, testID: "link-done" }]}>
      <Text style={st.lead}>A link is live. It always shows the current state of the original, never a copy.</Text>
      <Text style={st.label}>Search Vyre</Text>
      <TextField testID="link-search" accessibilityLabel="Search Vyre" autoFocus value={q} onChangeText={setQ} placeholder="Records, files, chats, tasks" placeholderTextColor="var(--ink-4)" style={st.input} />
      <View style={st.results} testID="link-results">
        {cands.length === 0 && hits !== null ? <Text testID="link-nothing" style={st.dim}>Nothing found in Vyre. Paste a link below instead.</Text> : null}
        {cands.map((c) => (
          <Pressable key={c.key} accessibilityRole="button" accessibilityLabel={`Link ${c.label}`} testID={`link-pick-${c.key}`} disabled={busy} onPress={() => void link(c.kind, c.ref, c.label)} style={({ hovered }: { hovered?: boolean }) => [st.res, hovered === true && st.hover]}>
            <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={st.resTitle}>{c.label}</Text><Text style={st.dim}>{KIND_WORD[c.kind].replace(/^./, (x) => x.toUpperCase())}</Text></View>
            <Text style={st.accent}>Link</Text>
          </Pressable>
        ))}
      </View>
      <Text style={st.label}>Paste a link</Text>
      <View style={st.pasteRow}>
        <TextField testID="link-url" accessibilityLabel="Paste a link" value={url} onChangeText={setUrl} onSubmitEditing={() => void paste()} placeholder="A GitHub pull request or commit, or any web link" placeholderTextColor="var(--ink-4)" style={[st.input, { flex: 1 }]} />
        <Pressable accessibilityRole="button" testID="link-url-go" disabled={busy} onPress={() => void paste()} style={st.go}><Text style={st.goText}>Link</Text></Pressable>
      </View>
      <Text testID="link-line" accessibilityLiveRegion="polite" style={st.dim}>{line}</Text>
    </Dialog>
  );
}

const st = StyleSheet.create({
  lead: { fontSize: 13, color: "var(--ink-3)" as string, marginBottom: 10 },
  label: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string, marginTop: 8, marginBottom: 4 },
  input: { height: 34, paddingHorizontal: 11, borderRadius: 9, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  results: { maxHeight: 240, marginTop: 4, marginBottom: 6 },
  res: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 8, borderRadius: 8 },
  resTitle: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  hover: { backgroundColor: "var(--hover)" },
  accent: { fontSize: 12.5, color: "var(--accent)" as string, fontWeight: "500" },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string, minHeight: 18 },
  pasteRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  go: { height: 34, paddingHorizontal: 14, borderRadius: 9, justifyContent: "center", backgroundColor: "var(--sel)" as string },
  goText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
});
