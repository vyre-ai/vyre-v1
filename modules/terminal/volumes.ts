// What the volumes of agent workspaces and the Space browser hold, as server health says it (27 Nov 2026, rc.44; audit: nothing bounded the disk an agent's home, Files mirror, project folders or browser profiles could
// use). A soft cap: nothing is stopped or deleted, the owner is told which volumes are over it and what to do. The sizes are Docker's own (`GET /system/df`, volumes), read at most once a few minutes.
import type { RoomFinding } from "./netroom.ts";

export interface VolumeUse {
  name: string;
  bytes: number;
}
/** A volume over this many megabytes is reported (VYRE_VOLUME_SOFT_CAP_MB overrides it). */
export const DEFAULT_SOFT_CAP_MB = 5120;
/** The volumes that are Vyre's: workspace homes, Files mirrors, people's folders, project folders, and a Space browser's profiles. */
const OURS = /^(vyre-ws-|vyre-wsproj-|vyre-sbrowser)/;

/** The sizes of Vyre's volumes in a `/system/df` answer, biggest first. */
export function volumesOf(df: unknown): VolumeUse[] {
  const v = (df as { Volumes?: Array<{ Name?: string; UsageData?: { Size?: number } }> } | null)?.Volumes ?? [];
  return v
    .flatMap((x) =>
      typeof x.Name === "string" && OURS.test(x.Name) && typeof x.UsageData?.Size === "number" && x.UsageData.Size >= 0
        ? [{ name: x.Name, bytes: x.UsageData.Size }]
        : [],
    )
    .sort((a, b) => b.bytes - a.bytes);
}

const gb = (n: number): string => `${(n / 1073741824).toFixed(1)} GB`;

/** Server health's line: how much the agents' volumes use together, and which ones are over the soft cap. */
export function volumeFinding(vols: readonly VolumeUse[], capMb: number, ok: string): RoomFinding {
  const total = vols.reduce((n, v) => n + v.bytes, 0);
  const over = vols.filter((v) => v.bytes > capMb * 1048576);
  const detail = `Agent computers use ${gb(total)} on this server across ${vols.length} volumes.`;
  if (over.length === 0) return { key: "host.agent_volumes", state: "healthy", detail, next: ok };
  const names = over
    .slice(0, 3)
    .map((v) => `${v.name} (${gb(v.bytes)})`)
    .join(", ");
  return {
    key: "host.agent_volumes",
    state: "degraded",
    detail: `${detail} ${over.length} ${over.length === 1 ? "is" : "are"} over ${gb(capMb * 1048576)}: ${names}${over.length > 3 ? ", and more" : ""}.`,
    next: "Ask the agent to clear what it no longer needs (its downloads, caches and old projects), or free disk on this server. Nothing was stopped or removed.",
  };
}
