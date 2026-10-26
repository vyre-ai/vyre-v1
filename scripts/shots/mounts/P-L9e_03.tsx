// Mount for P-L9e_03: the Files review surfaces over the Northwind sample Space (or Harbor Studio with ?space=harbor), inside the Files place: its sidebar (FilesTree) at 240 px (a phone shows the view alone)
// and a tab strip above the view, as in the prototype.
// ?part=review (default)  the changeset header and the diff of "Docs changed 3 files"; ?repo=1 makes the folder a git repository (commit message and Push), ?protected=1 puts it on a protected main (the Gate row,
// Approve off), ?panel=discard|request opens the Discard confirm or the Request changes note.
// ?part=git  the git row; ?part=history  AGENT.md with its History pane open and an older version showing under the banner; ?part=lint  AGENT.md with its header, lint chips, suggestion card and body; ?part=form  agent.toml in the Form view with an edit and the diff before the save.
// The query is read after mount (rule 25): the static export keeps its pre-rendered markup, so a first-render read shows stale state.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { TabStrip } from "../../../ui/src/TabStrip/index.tsx";
import { createSampleFiles, harbor as filesHarbor, northwind as filesNorthwind } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { AgentFileEditor, AgentFilePage, ChangesetDiff, ChangesetHeader, GitRow, ReviewDataProvider } from "../../../apps/app/src/places/files/review/index.ts";
import { AGENT_MD, AGENT_TOML, createSampleReview } from "../../../apps/app/src/places/files/review/sample.ts";

export const title = "Files: review";

type Part = "review" | "git" | "history" | "lint" | "form";
const PARTS: readonly Part[] = ["review", "git", "history", "lint", "form"];
const TAB: Record<Part, string> = { review: "rivera-engagement-letter.docx", git: "Rivera matter", history: "AGENT.md", lint: "AGENT.md", form: "agent.toml" };

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const harborSpace = q.get("space") === "harbor";
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  const sample = useMemo(() => createSampleReview({
    variant: harborSpace ? "harbor" : "northwind", repo: q.get("repo") === "1" || q.get("part") === "git", protectedBranch: q.get("protected") === "1",
  }), [q, harborSpace]);
  const files = useMemo(() => createSampleFiles(harborSpace ? filesHarbor : filesNorthwind), [harborSpace]);
  const part = PARTS.find((p) => p === q.get("part")) ?? "review";
  const panel = q.get("panel") === "discard" ? "discard" : q.get("panel") === "request" ? "request" : undefined;
  const density = phone ? "compact" : "regular";
  let body: ReactNode;
  if (part === "git") body = <GitRow folderId={sample.folderId} />;
  else if (part === "history") body = <AgentFilePage fileId={sample.fileIds.agent} name="AGENT.md" path="Agents/Intake" agentId="agt_intake" saved={AGENT_MD} version={4} density={density} startHistory startViewing="ver_a3" />;
  else if (part === "lint") body = <AgentFilePage fileId={sample.fileIds.agent} name="AGENT.md" path="Agents/Intake" agentId="agt_intake" saved={AGENT_MD} version={4} density={density} />;
  else if (part === "form") {
    body = (
      <AgentFileEditor
        fileId={sample.fileIds.toml} name="agent.toml" saved={AGENT_TOML} version={2} density={density}
        start={{ view: "form", draft: AGENT_TOML.replace("daily_budget = 12", "daily_budget = 20"), review: q.get("diff") === "1" }}
      />
    );
  } else {
    body = (
      <>
        <ChangesetHeader changesetId={sample.changesetId} {...(panel ? { panel } : {})} />
        {q.get("repo") === "1" || q.get("protected") === "1" ? <GitRow folderId={sample.folderId} /> : null}
        <ChangesetDiff changesetId={sample.changesetId} density={density} />
      </>
    );
  }
  const tabs = [{ key: "files", title: "Files" }, { key: "view", title: TAB[part] }];
  return (
    <FilesDataProvider value={files.data}>
      <FilesStateProvider initial={{ where: { kind: "folder", id: harborSpace ? "fld_h_clients" : "fld_sales" } }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: 240 }}><FilesTree /></View>}
          <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <TabStrip tabs={tabs} active="view" />
            <ReviewDataProvider value={sample.data}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>{body}</ScrollView>
            </ReviewDataProvider>
          </View>
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : <View style={{ flex: 1 }} />;
}
