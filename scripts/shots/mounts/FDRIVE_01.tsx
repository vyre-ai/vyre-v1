// Mount for FDRIVE_01 (lane f-drive, 13 Nov 2026): a live Google Drive. ?view=list (My Drive with a refused name shown under its safe name and two same-named items told apart), live (Live
// folders with the quiet "could not be shown" line; ?open=1 opens its list), csv (a live CSV that arrived: its rows), loading ("Getting this from Google Drive"), failed (Try again and Open in Google Drive).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { FilesList } from "../../../apps/app/src/places/files/list/index.ts";
import { createSampleFiles, northwind } from "../../../apps/app/src/places/files/list/sample.ts";
import type { SampleSpace } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { FileViewer } from "../../../apps/app/src/places/files/viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../../../apps/app/src/places/files/viewer/data.tsx";
import { createSampleViewer } from "../../../apps/app/src/places/files/viewer/sample.ts";
import type { ViewerData } from "../../../apps/app/src/places/files/viewer/model.ts";
import { FileTrail } from "../../../apps/app/src/places/files/viewer/FileTrail.tsx";
import { LiveFolders } from "../../../apps/app/src/places/files/live/LiveFolders.tsx";
import { liveRow } from "../../../apps/app/src/places/files/live/model.ts";

export const title = "A live Google Drive that keeps every file";

const DRIVE = { mountId: "mnt_drive", provider: "Google Drive" };
const HOUR = 3_600_000;
const PDF = "application/pdf";

const f = (id: string, name: string, ago: number, kind: "pdf" | "spreadsheet" = "pdf", size = 220_000) => ({
  id,
  name,
  folder: "fld_drive",
  kind,
  size,
  ago,
  by: "usr_irfad",
  source: "Google Drive",
  mime: kind === "pdf" ? PDF : "text/csv",
});

/** My Drive as the engine now brings it in: "Q3/Q4 plan.pdf" shows as "Q3-Q4 plan.pdf", the second "Budget.pdf" as "Budget (Google Drive).pdf", the second "Plans" folder the same way. */
const withDrive: SampleSpace = {
  ...northwind,
  folders: [
    ...northwind.folders,
    { id: "fld_drive", name: "My Drive", parent: null, section: "personal", source: DRIVE },
    { id: "fld_drive_plans", name: "Plans", parent: "fld_drive", section: "personal", source: DRIVE },
    { id: "fld_drive_plans2", name: "Plans (Google Drive)", parent: "fld_drive", section: "personal", source: DRIVE },
  ],
  files: [
    ...northwind.files,
    f("fil_a", "1 - Wallet Recharge.csv", 1 * HOUR, "spreadsheet", 171_664),
    f("fil_b", "Budget.pdf", 3 * HOUR),
    f("fil_c", "Budget (Google Drive).pdf", 5 * HOUR),
    f("fil_d", "Q3-Q4 plan.pdf", 26 * HOUR),
    f("fil_e", "Untitled", 30 * HOUR),
    f("fil_f", "Retainer agreement (signed).pdf", 4 * 24 * HOUR),
  ],
};

function List(): ReactNode {
  const sample = useMemo(() => createSampleFiles(withDrive), []);
  const data = useMemo(
    () => ({
      ...sample.data,
      call: async (cap: string, input: unknown): Promise<unknown> =>
        cap === "mounts.list"
          ? { mounts: [{ mountId: "mnt_drive", folderId: "fld_drive", state: "idle", lastSyncAt: Date.now() }] }
          : sample.data.call(cap, input),
    }),
    [sample],
  );
  return (
    <FilesDataProvider value={data}>
      <FilesStateProvider initial={{ where: { kind: "folder", id: "fld_drive" } }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <View style={{ width: 240 }}>
            <FilesTree />
          </View>
          <FilesList />
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

function Live(): ReactNode {
  const now = Date.now();
  const base = {
    folderId: "fld_drive",
    kind: "google_drive",
    provider: "Google Drive",
    mode: "live_only",
    state: "idle",
    lagSeconds: 0,
    pendingChanges: 0,
    conflicts: 0,
    reviewChanges: true,
  };
  const rows = [
    liveRow(
      {
        ...base,
        mountId: "mnt_drive",
        name: "My Drive",
        lastSyncAt: now - 20_000,
        skippedCount: 3,
        skipped: [
          { name: "Scan 0042.tif", reason: "It is too large to bring in." },
          {
            name: "Old plan / draft",
            reason: "It was moved or deleted while Vyre was reading the folder. The next pass looks again.",
          },
          { name: "Intake form responses", reason: "Vyre could not bring it in." },
        ],
      } as never,
      [],
      now,
    ),
    liveRow(
      { ...base, mountId: "mnt_team", folderId: "fld_team", name: "Team drive", lastSyncAt: now - 600_000 } as never,
      [],
      now,
    ),
  ];
  return (
    <LiveFolders
      rows={rows}
      busy={new Set()}
      said={null}
      onAction={() => undefined}
      onConnect={() => undefined}
      onRetry={() => undefined}
    />
  );
}

const CSV =
  "Date,Wallet,Amount,Status\n2026-11-02,Wallet 14,500.00,Paid\n2026-11-03,Wallet 9,1200.00,Paid\n2026-11-05,Wallet 22,250.00,Pending\n2026-11-07,Wallet 14,500.00,Paid\n2026-11-10,Wallet 3,75.00,Failed\n";

function Viewer({ mode }: { mode: "csv" | "loading" | "failed" }): ReactNode {
  const s = useMemo(() => {
    const v = createSampleViewer();
    const row = v.rows.get("f_fees")!;
    row.comments = [];
    row.data = {
      ...row.data,
      file: { ...row.data.file, name: "1 - Wallet Recharge.csv", mime: "text/csv", size: CSV.length, source: DRIVE },
      text: CSV,
      canEdit: false,
    } as ViewerData;
    const inner = v.data.call;
    return {
      ...v.data,
      pathOf: () => "Personal / My Drive",
      openUrl: () => undefined,
      call: async (cap: string, input: unknown): Promise<unknown> => {
        if (cap === "mounts.file_link")
          return {
            link: { openIn: "Google Drive", webUrl: "https://drive.google.com/", type: "google_file", edit: [] },
          };
        if (mode !== "csv" && cap === "files.get") return { file: { ...row.data.file, size: 0, source: DRIVE } };
        if (mode === "loading" && cap === "files.viewer_data") return new Promise(() => undefined);
        if (mode === "failed" && cap === "files.viewer_data")
          throw Object.assign(new Error("Vyre could not get this file from where it lives just now."), {
            code: "provider.unavailable",
          });
        return inner(cap, input);
      },
    };
  }, [mode]);
  return (
    <FilesViewerDataProvider value={s}>
      <FileViewer fileId="f_fees" />
    </FilesViewerDataProvider>
  );
}

/** An image shared with the person, opened from Shared with me: the Back arrow and the path above the viewer. */
function Trail({ where }: { where: "shared" | "folder" }): ReactNode {
  const files = useMemo(() => createSampleFiles(withDrive), []);
  const viewer = useMemo(() => {
    const v = createSampleViewer();
    const row = v.rows.get("f_offer")!;
    row.data = { ...row.data, file: { ...row.data.file, name: "MLA logo.png" } } as ViewerData;
    return { ...v.data, pathOf: () => "Shared with me" };
  }, []);
  const data = useMemo(
    () => ({
      ...files.data,
      call: async (cap: string, input: unknown): Promise<unknown> =>
        cap === "files.get"
          ? { file: { fileId: "f_offer", name: "MLA logo.png", folderId: "fld_drive" } }
          : files.data.call(cap, input),
    }),
    [files],
  );
  return (
    <FilesDataProvider value={data}>
      <FilesStateProvider
        initial={{ where: where === "shared" ? { kind: "shared" } : { kind: "folder", id: "fld_drive" } }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>
          <FileTrail fileId="f_offer" onBack={() => undefined} />
          <FilesViewerDataProvider value={viewer}>
            <FileViewer fileId="f_offer" />
          </FilesViewerDataProvider>
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const view = q.get("view") ?? "list";
  return (
    <View style={{ flex: 1, minHeight: 0 }} testID={`fdrive-${view}`}>
      {view === "trail" || view === "trail-folder" ? (
        <Trail where={view === "trail" ? "shared" : "folder"} />
      ) : view === "csv" || view === "loading" || view === "failed" ? (
        <Viewer mode={view} />
      ) : view === "live" ? (
        <Live />
      ) : (
        <List />
      )}
    </View>
  );
}

// The page reads its query after it is live (rule 25).
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""));
  }, []);
  return q ? <Page q={q} /> : null;
}
