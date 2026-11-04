// Mount for P-L9b_06c: Needs you over Northwind (default) or Harbor Studio (?v=harbor); ?sel=n1 opens the invoices request, ?sel=n8 the withdrawn one. Same sample Spaces as P-L9b_06.
// The query is read after mount (the static export keeps the first frame's markup). All rows are drawn (no scroll window).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { NeedsYou } from "../../../apps/app/src/places/chats/needsyou/NeedsYou.tsx";
import { createSample } from "../../../apps/app/src/places/chats/needsyou/sample.ts";

export const title = "Needs you (prototype fixes)";

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const sel = params.get("sel") ?? undefined;
  const sample = useMemo(() => createSample(params.get("v") === "harbor" ? "harbor" : "northwind"), [params]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <NeedsYou data={sample.data} window={{ start: 0, end: 500 }} {...(sel ? { initialSelected: sel } : {})} />
    </View>
  );
}
