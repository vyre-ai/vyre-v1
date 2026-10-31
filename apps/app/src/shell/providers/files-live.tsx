// Files > Live folders in the shell (rc.8): reads the Space's mounts and who can see each, keeps them fresh, and carries the buttons (Reconnect, Sync now, Pause, Resume, Open) to the capabilities.
// Reconnect signs in again right there (connect in place) and then syncs; GitHub's installation is mended in Settings.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { LiveFolders } from "../../places/files/live/LiveFolders.tsx";
import { liveRow, needsReconnect } from "../../places/files/live/model.ts";
import type { LiveAction, LiveRow, MountRow, Share } from "../../places/files/live/model.ts";
import { useOpenConnect } from "../connect/index.ts";
import type { ShellRuntime } from "./runtime.tsx";

const REFRESH_MS = 30_000;

export function LiveFoldersHost({ rt, onConnect }: { rt: ShellRuntime; onConnect(): void }): ReactElement {
  const openConnect = useOpenConnect();
  const [rows, setRows] = useState<readonly LiveRow[] | null | "error">(null);
  const [mounts, setMounts] = useState<readonly MountRow[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const read = (): void => {
      void (async () => {
        try {
          const list = ((await rt.call("mounts.list", {})) as { mounts: MountRow[] }).mounts;
          const shares = await Promise.all(list.map((m) => (rt.call("access.shares_of", { resource: { type: "folder", id: m.folderId } }) as Promise<{ shares: Share[] }>).then((o) => o.shares, () => null)));
          if (!live) return;
          const now = rt.clock().now;
          setMounts(list);
          setRows(list.map((m, i) => liveRow(m, shares[i] ?? null, now)));
        } catch { if (live) setRows((cur) => (Array.isArray(cur) ? cur : "error")); }
      })();
    };
    read();
    const t = setInterval(read, REFRESH_MS);
    return () => { live = false; clearInterval(t); };
  }, [rt, tick]);

  const act = useCallback(async (row: LiveRow, action: LiveAction): Promise<void> => {
    if (action === "open") { rt.open({ subject: { type: "folder", id: row.folderId } }); return; }
    const m = mounts.find((x) => x.mountId === row.mountId);
    setBusy((b) => new Set(b).add(row.mountId)); setSaid(null);
    try {
      if (action === "reconnect") {
        if (m?.kind === "github" || !openConnect) { rt.open({ screen: "mail.connections", args: { kind: m?.kind === "github" ? "github" : "outlook" } }); return; }
        const got = await openConnect({ kind: "connector", service: m?.kind === "google_drive" ? "google" : "microsoft" });
        if (!got) return;
        await rt.call("mounts.sync_now", { mountId: row.mountId, idempotencyKey: `live-reconnect:${row.mountId}:${rt.clock().now}` });
        setSaid(`${row.name} reconnected. Syncing.`);
      } else {
        const cap = action === "sync" ? "mounts.sync_now" : action === "pause" ? "mounts.pause" : "mounts.resume";
        await rt.call(cap, { mountId: row.mountId, idempotencyKey: `live-${action}:${row.mountId}:${rt.clock().now}` });
        setSaid(action === "sync" ? `Syncing ${row.name}.` : action === "pause" ? `${row.name} paused.` : `${row.name} resumed.`);
      }
      setTick((n) => n + 1);
    } catch { setSaid(`That did not work for ${row.name}. Try again.`); }
    finally { setBusy((b) => { const n = new Set(b); n.delete(row.mountId); return n; }); }
  }, [rt, mounts, openConnect]);

  return <LiveFolders rows={rows} busy={busy} said={said} onAction={(r, a) => void act(r, a)} onConnect={onConnect} onRetry={() => { setRows(null); setTick((n) => n + 1); }} />;
}

export { needsReconnect };
