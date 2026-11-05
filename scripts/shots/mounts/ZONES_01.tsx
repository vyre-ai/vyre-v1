// Mount for ZONES_01 (lane l-calendar): the existing sample mounts for Records, the project Overview, Files and a Files version history, drawn with the Space in America/Los_Angeles and the viewer in Asia/Karachi,
// so a datetime, a project's Dates, a file's modified time and a version stamp show the Space time with the hover card. ?scene=records|project|files|history. Each scene is the other mount unchanged.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { setCurrentZones } from "../../../lib/zones.ts";
import { ZonesProvider } from "../../../ui/src/Time/index.tsx";
import Records from "./P-L9d_01.tsx";
import Overview from "./OVERVIEW_01.tsx";
import Files from "./P-L9_36.tsx";
import History from "./P-L9_07.tsx";

export const title = "The Space time zone on records, projects, files and versions";
const ZONES = { space: "America/Los_Angeles", viewer: "Asia/Karachi" };

export default function Mount(): ReactNode {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setCurrentZones(ZONES); setScene(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("scene") ?? "records"); return () => setCurrentZones(null); }, []);
  if (scene === null) return <View style={{ flex: 1 }} />;
  const body = scene === "project" ? <Overview /> : scene === "files" ? <Files /> : scene === "history" ? <History /> : <Records />;
  return <ZonesProvider value={ZONES}><View style={{ flex: 1 }}>{body}</View></ZonesProvider>;
}
