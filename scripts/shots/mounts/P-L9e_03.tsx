// Mount for P-L9e_03: the Files review surfaces inside the whole shell (the app rail, the title bar, the shared place sidebar with the Files sidebar in it), over the Northwind sample Space (or Harbor
// Studio with ?space=harbor), the same Shell frame the P-L9e_01c mount draws.
// ?part=review (default)  the changeset header and the diff of "Docs changed 3 files"; ?repo=1 makes the folder a git repository (commit message and Push), ?protected=1 puts it on a protected main (the Gate row,
// Approve off), ?panel=discard|request opens the Discard confirm or the Request changes note.
// ?part=git  the git row; ?part=history  AGENT.md with its History pane open and an older version showing under the banner; ?part=lint  AGENT.md with its header, lint chips, suggestion card and body;
// ?part=form  agent.toml in the Form view with an edit and the diff before the save.
// The query is read after mount (rule 25): the static export keeps its pre-rendered markup, so a first-render read shows stale state.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { SidebarContent } from "../../../apps/app/src/shell/sidebar/index.ts";
import { createSampleFiles, harbor as filesHarbor, northwind as filesNorthwind } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { AgentFileEditor, AgentFilePage, ChangesetDiff, ChangesetHeader, GitRow, ReviewDataProvider } from "../../../apps/app/src/places/files/review/index.ts";
import { AGENT_MD, AGENT_TOML, createSampleReview } from "../../../apps/app/src/places/files/review/sample.ts";

export const title = "Files: review";

type Part = "review" | "git" | "history" | "lint" | "form";
const PARTS: readonly Part[] = ["review", "git", "history", "lint", "form"];

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

function Body({ q }: { q: URLSearchParams }): ReactNode {
  const harborSpace = q.get("space") === "harbor";
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  const sample = useMemo(() => createSampleReview({
    variant: harborSpace ? "harbor" : "northwind", repo: q.get("repo") === "1" || q.get("part") === "git", protectedBranch: q.get("protected") === "1",
  }), [q, harborSpace]);
  const files = useMemo(() => createSampleFiles(harborSpace ? filesHarbor : filesNorthwind, { subjects: true }), [harborSpace]);
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
  return (
    <FilesDataProvider value={files.data}>
      <FilesStateProvider initial={{ where: { kind: "folder", id: harborSpace ? "fld_hclients" : "fld_pjrivera" } }}>
        <View testID="files-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <SidebarContent title="Files" searchPlaceholder="Search files">{(query, slot) => <FilesTree query={query} slot={slot} />}</SidebarContent>
          <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <ReviewDataProvider value={sample.data}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>{body}</ScrollView>
            </ReviewDataProvider>
          </View>
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

function Framed({ q }: { q: URLSearchParams }): ReactNode {
  const made = useMemo(() => {
    const g = globalThis as { document?: { documentElement?: RootLike } };
    const skin = q.get("skin") ?? "paper";
    const root = g.document?.documentElement;
    const themeRoot: ThemeRoot = {
      setAttribute: (n, v) => { root?.setAttribute(n, v); },
      setProperty: (n, v) => { root?.style.setProperty(n, v); },
      removeProperty: (n) => { root?.style.removeProperty(n); },
    };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ openId: q.get("space") === "harbor" ? "hb" : "nw", theme });
    hub.go("files");
    return { hub, theme };
  }, [q]);
  const renderPlace = (ctx: PlaceContext): ReactNode => (ctx.place === "files" ? <Body key={ctx.spaceId} q={q} /> : samplePlace(ctx));
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <Shell hub={made.hub} theme={made.theme} renderPlace={renderPlace} />
    </View>
  );
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Framed q={q} /> : <View style={{ flex: 1 }} />;
}
