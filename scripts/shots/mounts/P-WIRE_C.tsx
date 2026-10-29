// Mount for the wired Files mounts (PR C): ?part=strip (default) a mounted folder in Files, with the status line over its list and the sidebar's Connect a folder row;
// ?v=github|drive|conflict|paused|off picks which mounted folder; ?part=sheet shows the mount sheet's first step with Google and GitHub not connected.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { FilesList } from "../../../apps/app/src/places/files/list/index.ts";
import { createSampleFiles, northwind } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { MountSheet, MountsDataProvider } from "../../../apps/app/src/places/files/mounts/index.ts";
import type { MountRow } from "../../../apps/app/src/places/files/mounts/index.ts";
import { createSampleMounts, northwindAccounts } from "../../../apps/app/src/places/files/mounts/sample.ts";
import { MountStrip } from "../../../apps/app/src/shell/providers/files-mounts.tsx";
import { sampleRuntime } from "../../../apps/app/src/shell/providers/misc-test-runtime.tsx";

export const title = "Files mounts";

const NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const base = { mode: "server_copy" as const, pendingChanges: 0, conflicts: 0 };
const ROWS: Record<string, MountRow> = {
  github: { ...base, mountId: "mnt_web", folderId: "fld_sales", kind: "github", provider: "GitHub", ref: "acme/website", name: "website", state: "idle", reviewChanges: false, lastSyncAt: NOW - 4 * 60_000 },
  drive: { ...base, mountId: "mnt_mk", folderId: "fld_sales", kind: "google_drive", provider: "Google Drive", ref: "gd:Marketing", name: "Marketing", state: "syncing", reviewChanges: true, pendingChanges: 3, lastSyncAt: NOW - 2 * 3_600_000 },
  conflict: { ...base, mountId: "mnt_ct", folderId: "fld_sales", kind: "sharepoint", provider: "SharePoint", ref: "sp:Contracts", name: "Contracts", state: "idle", reviewChanges: true, conflicts: 2, pendingChanges: 1, lastSyncAt: NOW - 20 * 60_000 },
  paused: { ...base, mountId: "mnt_ip", folderId: "fld_sales", kind: "local", provider: "This computer", ref: "~/Projects", name: "Projects", state: "paused", reviewChanges: false, fromDevice: "Irfad's MacBook", lastSyncAt: NOW - 86_400_000 },
  off: { ...base, mountId: "mnt_ex", folderId: "fld_sales", kind: "google_drive", provider: "Google Drive", ref: "gd:Marketing", name: "Marketing", state: "failing", error: "Google needs you to sign in again.", reviewChanges: false, lastSyncAt: NOW - 3 * 86_400_000 },
};

function Strip({ v }: { v: string }): ReactNode {
  const sample = useMemo(() => createSampleFiles(northwind), []);
  const rt = useMemo(() => sampleRuntime({ screens: sample.data.screens, call: async (cap) => (cap === "changesets.list" ? { changesets: [{ changesetId: "chg_1" }] } : {}) }), [sample]);
  const mount = ROWS[v] ?? ROWS["github"]!;
  const data = useMemo(() => ({ ...sample.data, nav: { ...sample.data.nav, connectFolder: () => undefined } }), [sample]);
  return (
    <FilesDataProvider value={data}>
      <FilesStateProvider initial={{ where: { kind: "folder", id: "fld_sales" } }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <View style={{ width: 240 }}><FilesTree /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <MountStrip rt={rt} mount={mount} onUnmount={() => undefined} onChanged={() => undefined} />
            <FilesList />
          </View>
        </View>
      </FilesStateProvider>
    </FilesDataProvider>
  );
}

function Sheet(): ReactNode {
  const s = useMemo(() => createSampleMounts({ accounts: { ...northwindAccounts, google_drive: { label: "", connected: false }, github: { label: "", connected: false } } }), []);
  return <MountsDataProvider value={s.data}><MountSheet onClose={() => undefined} onMounted={() => undefined} /></MountsDataProvider>;
}

function Page({ q }: { q: URLSearchParams }): ReactNode {
  return q.get("part") === "sheet" ? <Sheet /> : <Strip v={q.get("v") ?? "github"} />;
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page q={q} /> : null;
}
