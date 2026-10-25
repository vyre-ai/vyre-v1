// Mount for P-L9b_05: the agent page over the Northwind sample Space, where Intake is working on its computer and Omar Haddad, the owner, is signed in. ?tab=chats (default),
// memory, files, computer or settings picks the tab; ?v=viewer shows the page to a person who may not change the agent (the role line is read-only with a lock), paused shows
// Intake paused with the reason, broken a broken agent.toml, personal the Personal Space assistant. Every control works against the
// sample replica: Enter on the role line saves with Undo, Chat starts a chat, Pause and Resume, accept and dismiss a suggestion, routines on and off. All rows are drawn (no scroll
// window) so a screenshot shows the whole list.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { AgentPage } from "../../../apps/app/src/places/chats/agentpage/AgentPage.tsx";
import { DEFAULT_TAB, isTabKey } from "../../../apps/app/src/places/chats/agentpage/model.ts";
import { createSample } from "../../../apps/app/src/places/chats/agentpage/sample.ts";
import type { Variant } from "../../../apps/app/src/places/chats/agentpage/sample.ts";

export const title = "Agent page";

const VARIANTS: readonly Variant[] = ["owner", "viewer", "paused", "broken", "personal"];
const isVariant = (v: string | null): v is Variant => VARIANTS.includes(v as Variant);

export default function Mount(): ReactNode {
  // The query is read after mount: the static export renders the first frame without it, and the client must render that same frame or React leaves the exported markup behind.
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const v = params.get("v");
  const variant: Variant = isVariant(v) ? v : "owner";
  const tabParam = params.get("tab") ?? "";
  const sample = useMemo(() => createSample(variant), [variant]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <AgentPage data={sample.data} initialTab={isTabKey(tabParam) ? tabParam : DEFAULT_TAB} window={{ start: 0, end: 500 }} />
    </View>
  );
}
