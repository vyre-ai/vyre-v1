// Files > Knowledge > History: the trail of every change to what Vyre knows, newest first: the actor's face, who, what they did (learned, merged, moved to Trash, edited, flagged, restored, erased), the
// words and the reason, and when. The trail never holds content, so an erase reads "A fact was erased" and nothing more. Filter (a quiet header menu) picks Everyone, People, Agents or Upkeep with
// counts, and "Only <page>" when the screen was opened for one page; a banner says what is filtered and Show all clears it. Right-click: Open page, Restore (a removed fact), Copy.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { restoreFact } from "./actions.ts";
import { useLive, useMemoryData } from "./data.tsx";
import { Empty, Flash, KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";
import { ActorFace, ErrorLine, FilterBanner, KRow, MetaLine, capital, copyText, readError, useDoing, useLiveSafe, whoOf } from "./KnowRows.tsx";
import { stampText } from "./know.ts";
import type { KFact, TrailRow } from "./know.ts";
import { each } from "./model.ts";
import { QuietButton } from "./parts.tsx";

type Who = "all" | "person" | "agent" | "upkeep";
const WHO: readonly { id: Who; label: string }[] = [{ id: "all", label: "Everyone" }, { id: "person", label: "People" }, { id: "agent", label: "Agents" }, { id: "upkeep", label: "Upkeep" }];
const BANNER: Record<Who, string> = { all: "", person: "By people", agent: "By agents", upkeep: "By Upkeep" };

/** The word a trail row says: what the actor did. */
export function verbOf(a: TrailRow["action"]): string {
  switch (a) {
    case "create": case "learn": return "learned";
    case "merge": return "merged";
    case "delete": case "undo": return "moved to Trash";
    case "edit": return "edited";
    case "flag": return "flagged";
    case "restore": return "restored";
    case "erase": return "erased";
    case "archive": return "archived";
    case "accept": return "accepted";
    case "reject": return "rejected";
    case "promote": return "promoted";
    case "resolve": return "resolved";
  }
}
const VERB_COLOR: Partial<Record<TrailRow["action"], string>> = { create: "var(--ok)", learn: "var(--ok)", delete: "var(--danger)", undo: "var(--danger)", flag: "var(--warn)", restore: "var(--accent)" };

/** The text a trail row carries. An erase row has no content and says so; every other row says what changed. */
export function trailText(r: TrailRow): string {
  if (r.action === "erase") return "A fact was erased";
  return typeof r.detail?.text === "string" ? (r.detail.text as string) : "";
}

const kindOf = (r: TrailRow): "person" | "agent" | "upkeep" | "system" => r.actorKind;

export function KnowHistory({ pageId }: { pageId?: string }): ReactElement {
  const data = useMemoryData();
  const { nav } = data;
  const now = data.now();
  const who = whoOf(data);
  const menu = useMenu();
  const doing = useDoing();
  const [by, setBy] = useState<Who>("all");
  const tq = useLive("memory.trail", { ...(pageId ? { pageId } : {}), limit: 500 });
  const fq = useLive("memory.facts.list", { status: ["current", "closed", "removed"] });
  const pq = useLiveSafe("memory.page.get", { pageId: pageId ?? "" }, !pageId);
  const rows = (tq.status === "ready" ? tq.data.rows : []) as TrailRow[];
  const facts = (fq.status === "ready" ? fq.data.facts : []) as KFact[];
  const pageTitle = pageId && pq.status === "ready" ? pq.data.page.title : null;
  const failed = readError(tq, "Could not read the history");

  const sorted = [...rows].sort((a, b) => b.at - a.at);
  const count = (w: Who): number => (w === "all" ? sorted.length : sorted.filter((r) => kindOf(r) === w).length);
  const shown = by === "all" ? sorted : sorted.filter((r) => kindOf(r) === by);
  const active = by !== "all" || pageId !== undefined;
  const factOf = (r: TrailRow): KFact | undefined => (r.factId ? facts.find((f) => f.factId === r.factId) : undefined);
  const pageOf = (r: TrailRow): string | undefined => r.pageId ?? factOf(r)?.subject?.pageId;

  const filterEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [{ head: "Made by" }];
    for (const w of WHO) out.push({ label: w.label, checked: by === w.id, count: count(w.id), onSelect: () => setBy(w.id) });
    if (pageId) out.push({ separator: true }, { head: "Page" }, { label: `Only ${pageTitle ?? "this page"}`, checked: true, onSelect: () => nav.go({ v: "history" }) });
    out.push({ separator: true }, { label: "Show all", onSelect: clear });
    return out;
  };
  function clear(): void { setBy("all"); if (pageId) nav.go({ v: "history" }); }

  const restore = (f: KFact): void => doing.run("Could not restore the fact", () => restoreFact(data, f.factId), () => ({ text: "Restored." }));
  const line = (r: TrailRow): string => (r.action === "erase" ? trailText(r) : `${capital(who(r.actor))} ${verbOf(r.action)} ${trailText(r)}`.trim());
  const entries = (r: TrailRow): MenuEntry[] => {
    const f = factOf(r), page = pageOf(r);
    const removed = (r.action === "delete" || r.action === "undo" || r.action === "merge") && f !== undefined && f.status === "removed";
    return [
      ...(page ? [{ label: "Open page", onSelect: () => nav.go({ v: "page", pageId: page, ...(f ? { hl: f.factId } : {}) }) }] : []),
      ...(removed ? [{ label: "Restore", onSelect: () => restore(f!) }] : []),
      { label: "Copy", onSelect: () => copyText(line(r)) },
    ];
  };

  const bannerText = `${pageTitle ?? ""}${pageTitle && by !== "all" ? " · " : ""}${by !== "all" ? BANNER[by] : ""} · ${shown.length} shown`;
  const right = <QuietButton icon="filter" label="Filter" lit={active} testID="history-filter" onPress={(x, y) => menu.show(filterEntries(), x, y, "other")} />;

  return (
    <View style={frame.main} testID="know-history">
      <KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "History" }]} right={right} />
      <KnowColumn testID="know-history-body" label="History" title="History" lede="Every change to what Vyre knows: who made it, what changed and why. The trail is never deleted. An erase keeps a line with no content.">
        <Flash flash={doing.flash} onClose={() => doing.setFlash(null)} />
        <ErrorLine text={doing.err ?? failed} />
        {active ? <FilterBanner text={bannerText} onClear={clear} /> : null}
        <View accessibilityRole="list" accessibilityLabel="History" testID="history-rows" style={{ marginTop: 12 }}>
          {each(shown, (r) => {
            const text = trailText(r), name = capital(who(r.actor));
            const page = pageOf(r);
            return (
              <KRow
                key={r.id} testID={`trail-${r.id}`} label={line(r)} menu={() => entries(r)} dot={false} {...(page ? { onOpen: () => nav.go({ v: "page", pageId: page }) } : {})}
                main={(
                  <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                    <ActorFace name={r.actor === "upkeep" ? "Upkeep" : who(r.actor) === "you" ? data.me?.name ?? "You" : who(r.actor)} kind={kindOf(r)} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 14, lineHeight: 22, color: "var(--ink)" }}>
                        {r.action === "erase" ? <Text style={{ color: "var(--ink-2)" }}>{text}</Text> : (
                          <>
                            <Text style={{ fontWeight: "600" }}>{name}</Text>
                            <Text style={{ fontWeight: "500", color: VERB_COLOR[r.action] ?? "var(--ink-2)" }}>{` ${verbOf(r.action)}`}</Text>
                            {text ? ` ${text}` : ""}
                          </>
                        )}
                      </Text>
                      {r.reason ? <MetaLine parts={[r.reason]} /> : null}
                    </View>
                    <Text style={{ fontSize: 12, lineHeight: 22, color: "var(--ink-3)", fontVariant: ["tabular-nums"] }}>{stampText(r.at, now)}</Text>
                  </View>
                )}
              />
            );
          })}
        </View>
        {shown.length === 0 && tq.status === "ready" ? <Empty title="Nothing here" text="No changes match this filter." /> : null}
      </KnowColumn>
      {menu.element}
    </View>
  );
}
