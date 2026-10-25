// Mount for P-L9e_04: the mount sheets and the runbook viewer over the Northwind sample Space.
// ?part=mount (default) with ?step=1|2|3 and ?src=google_drive|microsoft|local|github  step 2 opens at the source's first level; ?q=text fills the repository search; ?pick=<ref> picks a row.
// ?part=unmount  the Unmount sheet for the Marketing mount.
// ?part=runbook with ?v=fresh|ran|fail|running  "Deploy website.md" with its Runs on bar, four shell blocks and its Runs; every control works against the sample shell (autoplay on).
import { useMemo } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { MountSheet, MountsDataProvider, UnmountSheet } from "../../../apps/app/src/places/files/mounts/index.ts";
import type { BrowseItem, Draft, SourceId } from "../../../apps/app/src/places/files/mounts/index.ts";
import { createSampleMounts, northwindMounts } from "../../../apps/app/src/places/files/mounts/sample.ts";
import { RunbookDataProvider, RunbookViewer } from "../../../apps/app/src/places/files/runbook/index.ts";
import { createSampleRunbook } from "../../../apps/app/src/places/files/runbook/sample.ts";
import type { Variant } from "../../../apps/app/src/places/files/runbook/sample.ts";

export const title = "Files: mounts and runbooks";

const SOURCES: readonly SourceId[] = ["google_drive", "microsoft", "local", "github"];
const VARIANTS: readonly Variant[] = ["fresh", "ran", "fail", "running"];
const noop = (): void => undefined;

function query(): URLSearchParams {
  return new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
}

/** What step 3 shows for a source: the thing the prototype's screenshot has picked. */
function picked(src: SourceId, ref: string | null): BrowseItem | null {
  if (src === "local") return { ref: ref ?? "~/Projects/vyre-site", name: (ref ?? "vyre-site").split("/").pop() ?? "vyre-site", isFolder: true, kind: "local" };
  if (src === "github") return { ref: ref ?? "northwind/billing-scripts", name: ref ?? "northwind/billing-scripts", isFolder: false, kind: "github" };
  if (src === "microsoft") return { ref: ref ?? "sp:Proposals", name: "Proposals", isFolder: true, kind: "sharepoint" };
  return { ref: ref ?? "gd:Sales", name: "Sales", isFolder: true, kind: "google_drive" };
}

function Mounts(): ReactNode {
  const q = useMemo(query, []);
  const sample = useMemo(() => createSampleMounts(), []);
  const step = Number(q.get("step") ?? 1);
  const src = SOURCES.find((s) => s === q.get("src")) ?? null;
  const initial = useMemo<Partial<Draft>>(() => {
    if (step < 2 || src === null) return {};
    const it = q.get("pick") || step === 3 ? picked(src, q.get("pick")) : null;
    return { step: step >= 3 ? 3 : 2, source: src, q: q.get("q") ?? "", ...(it ? { picked: it } : {}) };
  }, [q, step, src]);
  return (
    <MountsDataProvider value={sample.data}>
      <View style={{ flex: 1, position: "relative" }}>
        <MountSheet onClose={noop} onMounted={noop} into="fld_github" initial={initial} />
      </View>
    </MountsDataProvider>
  );
}

function Unmount(): ReactNode {
  const sample = useMemo(() => createSampleMounts(), []);
  return (
    <MountsDataProvider value={sample.data}>
      <View style={{ flex: 1, position: "relative" }}>
        <UnmountSheet mount={northwindMounts[0]!} onClose={noop} onRemoved={noop} />
      </View>
    </MountsDataProvider>
  );
}

function Runbook(): ReactNode {
  const q = useMemo(query, []);
  const v = VARIANTS.find((x) => x === q.get("v")) ?? "fresh";
  const sample = useMemo(() => createSampleRunbook(v, { autoplay: true }), [v]);
  return (
    <RunbookDataProvider value={sample.data}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: "center", paddingVertical: 24, paddingHorizontal: 16 }}>
        <RunbookViewer fileId={sample.fileId} text={sample.text} />
      </ScrollView>
    </RunbookDataProvider>
  );
}

export default function Mount(): ReactNode {
  const part = query().get("part") ?? "mount";
  if (part === "unmount") return <Unmount />;
  if (part === "runbook") return <Runbook />;
  return <Mounts />;
}
