// An agent's instruction file as the prototype shows it (vyre-v1.html, AGENT.md): the file header (name, where it lives, who saved it and when, View and Edit, find, info, history, Ask), then the lint chips,
// the agent's suggestion card, and the file itself, rendered in View and as text in Edit. The Ask control is the shared ui/AskButton over every agent of the Space.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AskButton } from "../../../../../../ui/src/AskButton/index.tsx";
import type { Density } from "../../../../../../ui/src/DiffTab/index.tsx";
import { AgentFileEditor } from "./AgentFileEditor.tsx";
import type { AgentFileEditorProps } from "./AgentFileEditor.tsx";
import { useCap, useReviewData } from "./data.tsx";
import { Glyph } from "./icons.tsx";
import { latestVersion, shortDay } from "./model.ts";
import { IconBtn, Segmented } from "./parts.tsx";
import { SuggestionCard } from "./SuggestionCard.tsx";

export interface AgentFilePageProps extends Omit<AgentFileEditorProps, "above" | "mode"> {
  /** "Agents/Intake". */
  path: string;
  agentId: string;
  density?: Density;
  /** Open in Edit. */
  edit?: boolean;
}

export function AgentFilePage({ path, agentId, edit = false, ...file }: AgentFilePageProps): ReactElement {
  const data = useReviewData();
  const versions = useCap("files.versions", { fileId: file.fileId });
  const [mode, setMode] = useState<"view" | "edit">(edit ? "edit" : "view");
  const [info, setInfo] = useState(false);
  const top = versions.status === "ready" ? latestVersion(versions.data.versions) : null;
  const agents = data.agents ?? [{ id: "assistant", name: "Assistant", assistant: true }];
  return (
    <View style={st.wrap} testID="agent-file-page">
      <View style={st.head}>
        <View style={st.title}>
          <Text accessibilityRole="header" aria-level={2} numberOfLines={1} style={st.h2} testID="agent-file-name">{file.name}</Text>
          <Text numberOfLines={1} style={st.meta}>
            {path}{top ? ` · ${data.nameOf(top.by)} · ${shortDay(top.at)}` : ""}
          </Text>
        </View>
        <Segmented options={[{ id: "view", label: "View" }, { id: "edit", label: "Edit" }]} value={mode} onChange={setMode} label="View or edit" testID="agent-file-mode" />
        <IconBtn label="Find in file" onPress={() => data.nav.findInFile?.(file.fileId)} testID="agent-file-find"><Glyph name="search" size={15} color="var(--ink-2)" /></IconBtn>
        <IconBtn label="Info" onPress={() => setInfo(!info)} testID="agent-file-info"><Glyph name="info" size={15} color={info ? "var(--accent)" : "var(--ink-2)"} /></IconBtn>
        <IconBtn label="History" onPress={() => data.nav.openHistory?.(file.fileId)} testID="agent-file-history"><Glyph name="history" size={15} color="var(--ink-2)" /></IconBtn>
        <AskButton
          place="files"
          context={{ kind: "file", id: file.fileId, title: file.name, access: "edit" }}
          agents={agents}
          suggested={agentId}
          compact={file.density === "compact"}
          testID="agent-file-ask"
          onAsk={(agent, askMode, about) => data.nav.ask?.(agent.id, askMode, { kind: about.kind, id: about.id, title: about.title })}
        />
      </View>
      {info ? <Text style={st.info} testID="agent-file-info-text">{`Version ${file.version} · ${file.saved.split("\n").length - (file.saved.endsWith("\n") ? 1 : 0)} lines · ${path}/${file.name}`}</Text> : null}
      <AgentFileEditor {...file} mode={mode} above={<SuggestionCard agentId={agentId} file={file.name} {...(file.density ? { density: file.density } : {})} />} />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: "100%" },
  head: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" },
  title: { flex: 1, minWidth: 0, marginRight: 8 },
  h2: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  meta: { fontSize: 12, color: "var(--ink-3)" as string },
  info: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 12, color: "var(--ink-3)" as string },
});
