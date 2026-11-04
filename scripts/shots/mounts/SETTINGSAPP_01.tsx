// Mount for the Settings restructure: one page at a time, ?part=profile|ai|github|notifications|appearance|computer|signin|moved-vault|moved-inbox, from the sample Space. Shots sit beside the prototype's.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { createSampleSettings, northwind } from "../../../apps/app/src/places/settings/sample.ts";

export const title = "Settings, the seven pages";

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "profile"), []);
  const { height } = useWindowDimensions();
  const [s] = useState(() => createSampleSettings(northwind));
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const page = part === "moved-vault" ? "connected" : part === "moved-inbox" ? "mail" : part;
  return <SettingsDataProvider value={s.data}><View style={{ height, backgroundColor: "var(--win)" as string }}><SettingsPlace initialPage={page as never} initialView="page" /></View></SettingsDataProvider>;
}
