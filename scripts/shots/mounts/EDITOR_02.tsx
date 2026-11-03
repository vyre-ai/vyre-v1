// Mount for l-editor: AGENT.md of the Intake agent in the one Markdown editor, a whole AgentFilePage inside the shell over the Northwind sample Space, with the Files tree beside it.
// ?part=edit (styled, the format bar), raw (the Markdown view), problem (a file that does not say it follows VYRE.md, its problems list open), saved (an edit made and saved: Saved with its number and Undo),
// view (the file read), select (a selection, with the bubble), paste (an indented Markdown paste turned into structure). The query is read after mount (rule 25).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { SidebarContent, useSidebarSlot } from "../../../apps/app/src/shell/sidebar/index.ts";
import { createSampleFiles, northwind as filesNorthwind } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { AgentFilePage, ReviewDataProvider } from "../../../apps/app/src/places/files/review/index.ts";
import { AGENT_MD, createSampleReview } from "../../../apps/app/src/places/files/review/sample.ts";

export const title = "Files: Markdown editor";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

function Body({ q }: { q: URLSearchParams }): ReactNode {
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  const sample = useMemo(() => createSampleReview({ intake: true }), []);
  const files = useMemo(() => createSampleFiles(filesNorthwind, { subjects: true }), []);
  const part = q.get("part") ?? "edit";
  const slot = useSidebarSlot();
  // Rule 25: the query is already read after mount (Mount below); opening the body is an effect too.
  // The slot resets to the list when it registers its sidebar, so the body opens once the sidebar is there.
  useEffect(() => { if (q.get("file") === "1" && slot.hasSidebar) slot.openBody(); }, [slot.hasSidebar]);
  // the states that need a person: a selection (the bubble), an indented paste, a problems list, an edit that was saved
  useEffect(() => {
    const w = globalThis as unknown as { document?: { querySelector(s: string): { focus(): void; dispatchEvent(e: unknown): void; querySelector(s: string): { firstChild: unknown; click(): void } | null } | null; createRange(): { setStart(n: unknown, o: number): void; setEnd(n: unknown, o: number): void }; getSelection(): { removeAllRanges(): void; addRange(r: unknown): void } | null; execCommand(c: string, u: boolean, v: string): boolean }; setTimeout(f: () => void, ms: number): void };
    if (part === "edit" || part === "view" || part === "raw") return;
    w.setTimeout(() => {
      const d = w.document; const ed = d?.querySelector(".vyre-md"); if (!d || !ed) return;
      ed.focus();
      if (part === "select") { const p = ed.querySelector("p"); const r = d.createRange(); r.setStart(p?.firstChild, 6); r.setEnd(p?.firstChild, 17); const s = d.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
      if (part === "problem") { const b = d.querySelector("[data-testid=lint-problems]"); b?.dispatchEvent(new (globalThis as unknown as { MouseEvent: new (t: string, o: object) => unknown }).MouseEvent("click", { bubbles: true })); }
    }, 2500);
  }, [part]);
  return (
    <FilesDataProvider value={files.data}>
      <FilesStateProvider initial={{ where: { kind: "folder", id: "fld_pj_rivera" } }}>
        <View testID="files-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <SidebarContent title="Files" searchPlaceholder="Search files">{(query, slot) => <FilesTree query={query} slot={slot} />}</SidebarContent>
          <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <ReviewDataProvider value={sample.data}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
                <AgentFilePage
                  fileId={sample.fileIds.agent} name="AGENT.md" path="Agents / Intake" agentId="agt_intake" saved={part === "problem" ? AGENT_MD.replace("Inherits VYRE.md.", "Be brief.") : AGENT_MD.replace("Inherits VYRE.md.", "Follows VYRE.md.")} version={4} density={phone ? "compact" : "regular"}
                  edit={part !== "view"} start={{ mdView: part === "raw" ? "raw" : "styled" }}
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
