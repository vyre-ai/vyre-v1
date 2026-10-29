// Mount for P-L9e_23: the Apps place over the Northwind sample. Query (read after mount, ruling 25): ?group=forms (default) | sites | campaigns | templates | domains, ?team=0 (a Personal Space),
// ?gate=1 (Publish and Launch wait for a yes), ?open=1 (on a phone, start on the list).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import Apps from "../../../apps/app/src/places/apps/shell/AppsPlace.tsx";
import type { GroupKey } from "../../../apps/app/src/places/apps/shell/model.ts";
import { createSampleApps } from "../../../apps/app/src/places/apps/shell/sample.ts";

export const title = "Apps place";
const GROUPS: readonly GroupKey[] = ["sites", "forms", "campaigns", "templates", "domains"];

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  const sample = useMemo(() => (q ? createSampleApps({ team: q.get("team") !== "0", gate: q.get("gate") === "1" }) : null), [q]);
  if (!q || !sample) return null;
  const group = GROUPS.find((g) => g === q.get("group")) ?? "forms";
  return <View style={{ flex: 1, height: "100%" as unknown as number, backgroundColor: "var(--win)" as string }}><Apps data={sample.data} start={{ group, ...(q.get("open") === "1" ? { open: true } : {}) }} /></View>;
}
