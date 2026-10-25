// Mount for P-L9f_06: the Settings place over the Northwind sample Space (the prototype's Settings), or Harbor Studio with ?space=harbor. ?page=<profile|notifications|models|connections|
// privacy|signin|appearance|keyboard|computer|spaces> picks the page, ?q= fills the search, ?view=nav starts a phone on the page list, ?copy=1 opens Copy from another Space.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { createSampleSettings, harbor, northwind } from "../../../apps/app/src/places/settings/sample.ts";
import type { PageKey } from "../../../apps/app/src/places/settings/model.ts";

export const title = "Settings";

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createSampleSettings(space), [space]);
  const { height } = useWindowDimensions();
  const page = (q.get("page") ?? "profile") as PageKey;
  return (
    <SettingsDataProvider value={sample.data}>
      <View style={{ height }}>
        <SettingsPlace initialPage={page} initialQuery={q.get("q") ?? ""} initialView={q.get("view") === "nav" ? "nav" : "page"} initialFound={q.get("found")} />
      </View>
    </SettingsDataProvider>
  );
}
