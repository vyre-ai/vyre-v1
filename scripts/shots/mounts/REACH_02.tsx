// Mount for rendered links (lane l-chrome2a): the real Files list over Northwind's Sales folder, as a member and as an admin. The Space's link policy answers access.reach for the rows on screen in one
// call; a file the person cannot open draws as plain text with no pointer (the member shot), and every row is a live link for an admin. ?part=member | admin
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { FilesList } from "../../../apps/app/src/places/files/list/index.ts";
import { createSampleFiles } from "../../../apps/app/src/places/files/list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../../../apps/app/src/places/files/tree/index.ts";
import { LinkPolicyProvider } from "../../../ui/src/reach/index.tsx";
import { createLinkPolicy } from "../../../apps/app/src/shell/reach/policy.ts";

export const title = "Rendered links";

function Page({ part }: { part: string }): ReactNode {
  const sample = useMemo(() => createSampleFiles(), []);
  const calls = useMemo(() => ({ n: 0 }), []);
  const policy = useMemo(() => createLinkPolicy({ call: async (cap, input) => {
    calls.n += 1;
    const items = (input as { items: Array<{ type: string; id: string }> }).items;
    return { items: items.map((x) => ({ type: x.type, id: x.id, level: part === "member" && x.id.includes("pricing") ? "none" : "manage" })) };
  } }), [part, calls]);
  const [, tick] = useState(0);
  useEffect(() => policy.subscribe(() => tick((n) => n + 1)), [policy]);
  return (
    <LinkPolicyProvider value={policy}>
      <FilesDataProvider value={sample.data}>
        <FilesStateProvider initial={{ where: { kind: "folder", id: "fld_sales" } }}>
          <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }} testID={`reach-files-${part}`}>
            <View style={{ width: 240 }}><FilesTree /></View>
            <FilesList />
          </View>
        </FilesStateProvider>
      </FilesDataProvider>
    </LinkPolicyProvider>
  );
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "member"), []);
  return part === null ? null : <Page part={part} />;
}
