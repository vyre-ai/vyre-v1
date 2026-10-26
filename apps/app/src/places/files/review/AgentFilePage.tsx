// An agent's instruction file as the prototype shows it (vyre-v1.html, AGENT.md): the file header (name, where it lives, who saved it and when, the version check, View and Edit, find, info, history, Ask), then the lint chips,
// the agent's suggestion card, and the file itself, rendered in View and as text in Edit. History opens in the shared ui/SidePane; picking an older version shows the shared version banner over the page with what changed since.
// The Ask control is the shared ui/AskButton over every agent of the Space. Find and History call the shell's hooks when it has them (data.nav) and work in the page when it has not.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AskButton } from "../../../../../../ui/src/AskButton/index.tsx";
import type { Density } from "../../../../../../ui/src/DiffTab/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { VersionBanner } from "../../../../../../ui/src/HistoryTab/index.tsx";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { restoreVersion } from "./actions.ts";
import { AgentFileEditor } from "./AgentFileEditor.tsx";
import type { AgentFileEditorProps } from "./AgentFileEditor.tsx";
import { FileDiff } from "./DiffPanels.tsx";
import { useCap, useReviewData } from "./data.tsx";
import { HistoryPanel } from "./HistoryPanel.tsx";
import { Glyph } from "./icons.tsx";
import { applySuggestion, historyVersions, latestVersion, shortDay } from "./model.ts";
import { Btn, IconBtn, Note, Segmented, TextField, anchorOf } from "./parts.tsx";
import { SuggestionCard } from "./SuggestionCard.tsx";

export interface AgentFilePageProps extends Omit<AgentFileEditorProps, "above" | "mode"> {
  /** "Agents/Intake". */
  path: string;
  agentId: string;
  density?: Density;
  /** Open in Edit. */
  edit?: boolean;
  /** Open with the History pane showing, and this version picked (the screenshot mount and the tests). */
  startHistory?: boolean;
  startViewing?: string;
}

/** "MD" for AGENT.md, "TOML" for agent.toml: the file-type tile. */
export function extOf(name: string): string {
  const e = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return (e || "FILE").toUpperCase();
}

export function AgentFilePage({ path, agentId, edit = false, startHistory = false, startViewing, ...file }: AgentFilePageProps): ReactElement {
  const data = useReviewData();
  const versions = useCap("files.versions", { fileId: file.fileId });
  const [mode, setMode] = useState<"view" | "edit">(edit ? "edit" : "view");
  const [info, setInfo] = useState(false);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [pane, setPane] = useState(startHistory);
  const [viewing, setViewing] = useState<string | null>(startViewing ?? null);
  const [changes, setChanges] = useState(true);
  const [applied, setApplied] = useState<string | null>(null);
  const [line, setLine] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const { element: menu, show } = useMenu();

  const rows = versions.status === "ready" ? versions.data.versions : [];
  const top = latestVersion(rows);
  const list = useMemo(() => historyVersions(rows, data.nameOf), [rows, data]);
  const picked = list.find((v) => v.id === viewing) ?? null;
  const current = list.find((v) => v.n === top?.n) ?? null;
  const text = applied ? applySuggestion(file.saved, applied) : file.saved;
  const version = Math.max(top?.n ?? 0, file.version + (applied ? 1 : 0));
  const matches = query ? text.split(query).length - 1 : 0;
  const agents = data.agents ?? [{ id: "assistant", name: "Assistant", assistant: true }];
  const looking = picked !== null && current !== null && picked.id !== current.id;

  const toggleHistory = (): void => {
    if (data.nav.openHistory) data.nav.openHistory(file.fileId);
    else setPane(!pane);
  };
  const toggleFind = (): void => {
    data.nav.findInFile?.(file.fileId);
    setFinding(!finding);
  };
  const restore = (): void => {
    if (!picked) return;
    void restoreVersion(data.call, file.fileId, picked.id).then((r) => {
      if (r.ok) { setViewing(null); setLine({ kind: "ok", text: `Restored version ${picked.n} as a new version.` }); } else setLine({ kind: "error", text: r.error });
    });
  };

  const copyPath = (): void => {
    const g = globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } };
    void g.navigator?.clipboard?.writeText?.(`${path}/${file.name}`)?.catch(() => undefined);
    setLine({ kind: "ok", text: "Copied the path." });
  };
  const openMore = (e: unknown): void => {
    const at = anchorOf(e);
    show([
      { label: pane ? "Hide history" : "Show history", onSelect: toggleHistory },
      { label: finding ? "Close find" : "Find in file", onSelect: toggleFind },
      { label: info ? "Hide info" : "Show info", onSelect: () => setInfo(!info) },
      { separator: true },
      { label: "Copy path", onSelect: copyPath },
    ], at.x, at.y, "other");
  };
  const compact = file.density === "compact";

  const main = (
    <View style={st.main}>
      <View style={st.head}>
        <View style={st.tile} testID="agent-file-tile" aria-hidden><Text style={st.tileText}>{extOf(file.name)}</Text></View>
        <View style={st.title}>
          <Text accessibilityRole="header" aria-level={2} numberOfLines={1} style={st.h2} testID="agent-file-name">{file.name}</Text>
          <Text numberOfLines={1} style={st.meta}>
            {path}{top ? ` · ${data.nameOf(top.by)} · ${shortDay(top.at)}` : ""}
          </Text>
        </View>
        <View style={st.ver} testID="agent-file-version" aria-label={`Version ${version}`}>
          <Glyph name="check" size={13} color="var(--ok)" width={1.8} />
          <Text style={st.verText}>{`v${version}`}</Text>
        </View>
        <Segmented options={[{ id: "view", label: "View" }, { id: "edit", label: "Edit" }]} value={mode} onChange={setMode} label="View or edit" testID="agent-file-mode" />
        <IconBtn label="Find in file" onPress={toggleFind} testID="agent-file-find"><Glyph name="search" size={15} color={finding ? "var(--accent)" : "var(--ink-2)"} /></IconBtn>
        <IconBtn label="Info" onPress={() => setInfo(!info)} testID="agent-file-info"><Glyph name="info" size={15} color={info ? "var(--accent)" : "var(--ink-2)"} /></IconBtn>
        <IconBtn label="History" onPress={toggleHistory} testID="agent-file-history"><Glyph name="history" size={15} color={pane ? "var(--accent)" : "var(--ink-2)"} /></IconBtn>
        <AskButton
          place="files"
          context={{ kind: "file", id: file.fileId, title: file.name, access: "edit" }}
          agents={agents}
          suggested={agentId}
          compact={file.density === "compact"}
          testID="agent-file-ask"
          onAsk={(agent, askMode, about) => data.nav.ask?.(agent.id, askMode, { kind: about.kind, id: about.id, title: about.title })}
        />
        <IconBtn label="More" onPress={openMore} menu testID="agent-file-more"><Glyph name="more" size={15} color="var(--ink-2)" width={1.8} /></IconBtn>
      </View>
      {info ? <Text style={st.info} testID="agent-file-info-text">{`Version ${version} · ${text.split("\n").length - (text.endsWith("\n") ? 1 : 0)} lines · ${path}/${file.name}`}</Text> : null}
      {finding ? (
        <View style={st.find} testID="agent-file-find-bar">
          <TextField value={query} onChange={setQuery} label="Find in file" placeholder="Find in file" onEscape={() => setFinding(false)} testID="agent-file-find-text" autoFocus />
          <Text style={st.count} testID="agent-file-find-count">{query ? `${matches} ${matches === 1 ? "match" : "matches"}` : ""}</Text>
        </View>
      ) : null}
      {looking && picked ? (
        <VersionBanner version={picked} showingChanges={changes} canRestore onToggleChanges={() => setChanges(!changes)} onRestore={restore} onBack={() => setViewing(null)} />
      ) : null}
      {line ? <Note text={line.text} kind={line.kind} /> : null}
      {looking && picked && changes && current ? (
        <FileDiff fileId={file.fileId} from={picked.id} to={current.id} name={file.name} {...(file.density ? { density: file.density } : {})} />
      ) : (
        <AgentFileEditor
          key={applied ? "applied" : "base"}
          {...file}
          saved={text}
          version={version}
          mode={mode}
          above={<SuggestionCard agentId={agentId} file={file.name} onApplied={setApplied} {...(file.density ? { density: file.density } : {})} />}
        />
      )}
    </View>
  );

  const history = <HistoryPanel fileId={file.fileId} density="compact" selectedId={viewing} onSelect={(id) => setViewing(id === top?.versionId ? null : id)} />;
  return (
    <View style={[st.wrap, compact && st.wrapCompact]} testID="agent-file-page">
      {main}
      {menu}
      {pane && compact ? (
        <View style={st.under} testID="agent-file-history-pane" role="region" aria-label="History">
          <View style={st.underHead}>
            <Text accessibilityRole="header" aria-level={3} style={st.underTitle}>History</Text>
            <Btn label="Hide" small onPress={() => setPane(false)} testID="agent-file-history-hide" />
          </View>
          {history}
        </View>
      ) : null}
      {pane && !compact ? (
        <SidePane paneKey="file-history" toggle={{ open: true, onPress: () => setPane(false) }} title="History" tabs={[{ key: "history", title: "History" }]} activeTab="history">
          {history}
        </SidePane>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: "100%", flexDirection: "row", alignItems: "flex-start" },
  wrapCompact: { flexDirection: "column", alignItems: "stretch" },
  under: { borderTopWidth: 1, borderTopColor: "var(--line)", paddingTop: 4 },
  underHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 6 },
  underTitle: { flex: 1, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  tile: { width: 30, height: 30, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, marginRight: 4 },
  tileText: { fontSize: 9.5, fontWeight: "700", color: "var(--ink-3)" as string, letterSpacing: 0.3 },
  main: { flex: 1, minWidth: 0 },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" },
  title: { flex: 1, minWidth: 0, marginRight: 8 },
  h2: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  meta: { fontSize: 12, color: "var(--ink-3)" as string },
  ver: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 6 },
  verText: { fontSize: 12, color: "var(--ink-3)" as string },
  info: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 12, color: "var(--ink-3)" as string },
  find: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  count: { fontSize: 12, color: "var(--ink-3)" as string, minWidth: 70 },
});
