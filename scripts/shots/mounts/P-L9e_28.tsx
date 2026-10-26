// Mount for P-L9e_28: agent.toml as the prototype's Form view, a whole AgentFilePage (file header, lint chips, the grouped form) inside the shell over the Northwind sample Space, with the Files tree beside it.
// ?diff=1 changes one value in the form and starts the diff before the save, which sits in the History pane beside the file (never under the form); ?view=text opens the Text view instead of the Form.
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
import { createSampleFiles, northwind as filesNorthwind } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { AgentFilePage, ReviewDataProvider } from "../../../apps/app/src/places/files/review/index.ts";
import { AGENT_TOML_INTAKE, createSampleReview } from "../../../apps/app/src/places/files/review/sample.ts";

export const title = "Files: agent.toml form";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

function Body({ q }: { q: URLSearchParams }): ReactNode {
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  const sample = useMemo(() => createSampleReview({ intake: true }), []);
  const files = useMemo(() => createSampleFiles(filesNorthwind, { subjects: true }), []);
  const diff = q.get("diff") === "1";
  return (
    <FilesDataProvider value={files.data}>
      <FilesStateProvider initial={{ where: { kind: "folder", id: "fld_pj_rivera" } }}>
        <View testID="files-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <SidebarContent title="Files" searchPlaceholder="Search files">{(query, slot) => <FilesTree query={query} slot={slot} />}</SidebarContent>
          <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <ReviewDataProvider value={sample.data}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
                <AgentFilePage
                  fileId={sample.fileIds.toml} name="agent.toml" path="Agents / Intake" agentId="agt_intake" saved={AGENT_TOML_INTAKE} version={3} density={phone ? "compact" : "regular"}
                  start={{ view: q.get("view") === "text" ? "text" : "form", ...(diff ? { draft: AGENT_TOML_INTAKE.replace("max_output_tokens = 3000", "max_output_tokens = 4000"), review: true } : {}) }}
                />
              </ScrollView>
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
    const hub = createSampleShell({ openId: "nw", theme });
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
