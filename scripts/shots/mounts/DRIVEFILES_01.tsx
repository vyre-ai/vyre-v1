// Mount for DRIVEFILES_01 (lane l-drivefiles, the rc.14 report): a connected Google Drive in Files. ?view=list (the Drive folder: Google Docs, Sheets and Slides tiles, the Drive mark on the
// tree and on the PDF row), doc (the Salvo Law Google Doc open in the viewer, its words under the Google Docs tile with Open in Google Docs), sheet (a Google Sheet as a table), form (a
// Google Form: no preview, Open in Google Forms), live (Live folders with the Drive mark), tabs (Inbox and Chats once each after opening conversations and chats inside them).
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
import { LiveFolders } from "../../../apps/app/src/places/files/live/LiveFolders.tsx";
import { liveRow } from "../../../apps/app/src/places/files/live/model.ts";
import { MainTabs } from "../../../apps/app/src/shell/tabs/MainTabs.tsx";
import { createTabsController } from "../../../apps/app/src/shell/tabs/store.ts";

export const title = "Google Drive in Files";

const NATIVE = "application/vnd.google-apps.";
const DRIVE = { mountId: "mnt_drive", provider: "Google Drive" };
const HOUR = 3_600_000;

/** Northwind with the person's own Drive mounted in Personal, as Connect your company does it. */
const withDrive: SampleSpace = {
  ...northwind,
  folders: [...northwind.folders, { id: "fld_drive", name: "My Drive", parent: null, section: "personal", source: DRIVE }, { id: "fld_drive_clients", name: "Clients", parent: "fld_drive", section: "personal", source: DRIVE }],
  files: [
    ...northwind.files,
    { id: "fil_seo", name: "Salvo Law SEO Audit and Keyword Report (October 2026)", folder: "fld_drive", kind: "google_native", size: 48_200, ago: 2 * HOUR, by: "usr_irfad", source: "Google Drive", mime: `${NATIVE}document` },
    { id: "fil_kw", name: "Keyword tracker", folder: "fld_drive", kind: "google_native", size: 12_400, ago: 5 * HOUR, by: "usr_irfad", source: "Google Drive", mime: `${NATIVE}spreadsheet` },
    { id: "fil_pitch", name: "Q4 pitch", folder: "fld_drive", kind: "google_native", size: 310_000, ago: 26 * HOUR, by: "usr_irfad", source: "Google Drive", mime: `${NATIVE}presentation` },
    { id: "fil_intake", name: "Client intake", folder: "fld_drive", kind: "google_native", size: 0, ago: 3 * 24 * HOUR, by: "usr_irfad", source: "Google Drive", mime: `${NATIVE}form` },
    { id: "fil_scan", name: "Retainer agreement (signed).pdf", folder: "fld_drive", kind: "pdf", size: 220_000, ago: 4 * 24 * HOUR, by: "usr_irfad", source: "Google Drive", mime: "application/pdf" },
  ],
};

const DOC = [
  "# SEO audit and keyword report",
  "Prepared for Salvo Law, October 2026\\.",
  "## Summary",
  "Salvo Law ranks on page one for 14 of 40 tracked terms. The biggest gaps are local terms in Roseville and Sacramento.",
  "## Top keywords",
  "| Keyword | Volume | Position |",
  "| :---- | :---- | :---- |",
  "| personal injury lawyer roseville | 480 | 12 |",
  "| car accident attorney sacramento | 1,300 | 18 |",
  "## Next steps",
  "- Add a Roseville practice page with **local reviews**",
  "- Fix the 6 pages with missing titles",
  "[image]",
].join("\n");
const CSV = "Keyword,Volume,Position,Change\npersonal injury lawyer roseville,480,12,+3\ncar accident attorney sacramento,1300,18,-1\nslip and fall lawyer,590,7,+2\nwrongful death attorney,260,22,0\n";

function Viewer({ kind }: { kind: "doc" | "sheet" | "form" }): ReactNode {
  const s = useMemo(() => {
    const v = createSampleViewer();
    const row = v.rows.get("f_note")!;
    row.comments = [];
    const mime = kind === "doc" ? `${NATIVE}document` : kind === "sheet" ? `${NATIVE}spreadsheet` : `${NATIVE}form`;
    const name = kind === "doc" ? "Salvo Law SEO Audit and Keyword Report (October 2026)" : kind === "sheet" ? "Keyword tracker" : "Client intake";
    row.data = { ...row.data, file: { ...row.data.file, name, kind: "google_native", mime, source: DRIVE }, text: kind === "doc" ? DOC : kind === "sheet" ? CSV : undefined, canEdit: false, snapshot: { exportedAt: 1, editVia: "provider_api" } } as ViewerData;
    const app = kind === "doc" ? "Google Docs" : kind === "sheet" ? "Google Sheets" : "Google Forms";
    const inner = v.data.call;
    return { ...v.data, pathOf: () => "Personal / My Drive", openUrl: () => undefined, call: async (cap: string, input: unknown): Promise<unknown> => (cap === "mounts.file_link" ? { link: { openIn: app, webUrl: "https://docs.google.com/", type: "google_doc", edit: [] } } : inner(cap, input)) };
  }, [kind]);
  return <FilesViewerDataProvider value={s}><FileViewer fileId="f_note" /></FilesViewerDataProvider>;
}

function List(): ReactNode {
  const sample = useMemo(() => createSampleFiles(withDrive), []);
  const data = useMemo(() => ({ ...sample.data, call: async (cap: string, input: unknown): Promise<unknown> => (cap === "mounts.list" ? { mounts: [{ mountId: "mnt_drive", folderId: "fld_drive", state: "idle", lastSyncAt: Date.now() }] } : sample.data.call(cap, input)) }), [sample]);
  return (
    <FilesDataProvider value={data}>
      <FilesStateProvider initial={{ where: { kind: "folder", id: "fld_drive" } }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <View style={{ width: 240 }}><FilesTree /></View>
          <FilesList />
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

function Live(): ReactNode {
  const now = Date.now();
  const rows = [
    liveRow({ mountId: "mnt_drive", folderId: "fld_drive", name: "My Drive", kind: "google_drive", provider: "Google Drive", mode: "live_only", state: "idle", lastSyncAt: now - 20_000, lagSeconds: 0, pendingChanges: 0, conflicts: 0, reviewChanges: true } as never, [], now),
    liveRow({ mountId: "mnt_od", folderId: "fld_od", name: "OneDrive", kind: "onedrive", provider: "OneDrive", mode: "live_only", state: "idle", lastSyncAt: now - 600_000, lagSeconds: 0, pendingChanges: 0, conflicts: 0, reviewChanges: true } as never, [], now),
    liveRow({ mountId: "mnt_gh", folderId: "fld_gh", name: "acme/site", kind: "github", provider: "GitHub", mode: "server_copy", state: "idle", lastSyncAt: now - 3_600_000, lagSeconds: 0, pendingChanges: 0, conflicts: 0, reviewChanges: true } as never, [], now),
  ];
  return <LiveFolders rows={rows} busy={new Set()} said={null} onAction={() => undefined} onConnect={() => undefined} onRetry={() => undefined} />;
}

function Tabs(): ReactNode {
  const c = useMemo(() => {
    const t = createTabsController({ deviceId: "web", personId: "p", spaceId: "s", storage: null, start: "chats" });
    t.openPlace("inbox");
    for (const id of ["cnv_1", "cnv_2", "cnv_3"]) t.move("inbox", `subject=conversation:${id}`);
    t.openPlace("files");
    t.move("files", "subject=file:fil_seo");
    t.select("chats");
    for (const id of ["thr_1", "thr_2"]) t.move("chats", `subject=thread:${id}`);
    t.openPlace("inbox");
    return t;
  }, []);
  return <View style={{ padding: 16 }}><MainTabs controller={c} /></View>;
}

function Page({ q }: { q: URLSearchParams }): ReactNode {
  const view = q.get("view") ?? "list";
  return (
    <View style={{ flex: 1, minHeight: 0 }} testID={`drivefiles-${view}`}>
      {view === "doc" || view === "sheet" || view === "form" ? <Viewer kind={view} /> : view === "live" ? <Live /> : view === "tabs" ? <Tabs /> : <List />}
    </View>
  );
}

// The page reads its query after it is live (rule 25).
export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
