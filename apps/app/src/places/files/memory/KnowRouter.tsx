// Which Knowledge screen has the body of Files. The route comes from the place (and the tab's hash); each screen draws its own column inside KnowFrame.
import type { ReactElement } from "react";
import { View } from "react-native";
import { useOptionalMemoryData } from "./data.tsx";
import { MemoryGraph } from "./MemoryGraph.tsx";
import { KnowHeader, frame } from "./KnowFrame.tsx";
import { KnowArchive } from "./KnowArchive.tsx";
import { KnowHistory } from "./KnowHistory.tsx";
import { KnowLearned } from "./KnowLearned.tsx";
import { KnowList } from "./KnowList.tsx";
import { KnowPage } from "./KnowPage.tsx";
import { KnowSearch } from "./KnowSearch.tsx";
import { KnowTrash } from "./KnowTrash.tsx";
import type { KnowRoute } from "./know.ts";

export function KnowRouter({ route }: { route: KnowRoute }): ReactElement {
  const data = useOptionalMemoryData();
  if (!data) return <View style={frame.main} testID="know-loading" accessibilityLabel="Loading"><KnowHeader crumbs={[{ t: "Knowledge" }]} /></View>;
  switch (route.v) {
    case "learned": return <KnowLearned />;
    case "list": return <KnowList kind={route.kind} />;
    case "page": return <KnowPage pageId={route.pageId} {...(route.hl ? { hl: route.hl } : {})} />;
    case "graph": return <MemoryGraph {...(route.focus ? { focus: route.focus } : {})} {...(route.scope ? { around: route.scope === "around" } : {})} {...(route.edge ? { edge: route.edge } : {})} />;
    case "history": return <KnowHistory {...(route.pageId ? { pageId: route.pageId } : {})} />;
    case "trash": return <KnowTrash {...(route.pageId ? { pageId: route.pageId } : {})} />;
    case "archive": return <KnowArchive />;
    case "search": return <KnowSearch q={route.q} />;
  }
}
