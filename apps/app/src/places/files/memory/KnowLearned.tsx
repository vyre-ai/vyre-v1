// Files > Knowledge > Learned: the feed of what Vyre picked up, newest first, in Today, Yesterday and Earlier. Each row is a fact with its subject, its source chip and who learned it from whom; Undo
// sends it to Trash (the line that says so has an Undo that restores it), Edit turns the text into an input (Enter saves, Escape cancels; the old wording is kept in history), and a press on the subject
// opens its page. Upkeep rows (merged, flagged) have an Open button and no Undo. Filter (a quiet header menu) sets the window and who learned it; By agent opens an agent's own memory. Facts that wait
// for review (a Space that asks for it) sit in their own section at the top with Accept and Reject. Right-click on a row: Undo, Edit, Open page, Open source, Copy fact.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { acceptFact, correctFact, rejectFact, restoreFact, undoFact } from "./actions.ts";
import { useLive, useMemoryData } from "./data.tsx";
import { Empty, Flash, KnowColumn, KnowHeader, SectionHead, frame } from "./KnowFrame.tsx";
import { DAY_MS, DayHead, ErrorLine, FactRow, FilterBanner, KRow, MetaLine, Subject, capital, copyText, openSourceOf, readError, useDoing, whoOf } from "./KnowRows.tsx";
import { TextButton } from "./KnowParts.tsx";
import { groupByDay, learnedLine, stampText } from "./know.ts";
import type { KFact, LearnedItem } from "./know.ts";
import { each, lands } from "./model.ts";
import { QuietButton } from "./parts.tsx";
import { View } from "react-native";

type Item = LearnedItem & { fact: KFact };
type Window = 7 | 30 | 0;
export const WINDOWS: readonly { days: Window; label: string }[] = [{ days: 7, label: "Last 7 days" }, { days: 30, label: "Last 30 days" }, { days: 0, label: "All time" }];
const byKey = (x: Item): string => (x.actorKind === "upkeep" ? "upkeep" : x.actor);

/** The items a "Learned by" choice keeps (nothing chosen keeps all); upkeep items answer to "upkeep". */
export function filterLearned<T extends { actor: string; actorKind: string }>(items: readonly T[], by: ReadonlySet<string>): T[] {
  return by.size === 0 ? [...items] : items.filter((x) => by.has(x.actorKind === "upkeep" ? "upkeep" : x.actor));
}
/** "Last 7 days · learned by Intake · 3 shown": what the filter banner says. */
export function learnedBanner(win: Window, by: readonly string[], shown: number): string {
  return `${WINDOWS.find((w) => w.days === win)!.label}${by.length > 0 ? ` \u00b7 learned by ${by.join(", ")}` : ""} \u00b7 ${shown} shown`;
}

export function KnowLearned(): ReactElement {
  const data = useMemoryData();
  const { nav } = data;
  const now = data.now();
  const who = whoOf(data);
  const menu = useMenu();
  const doing = useDoing();
  const [win, setWin] = useState<Window>(7);
  const [by, setBy] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const since = win === 0 ? undefined : Math.floor((now - win * DAY_MS) / 60_000) * 60_000;
  const lq = useLive("memory.learned", { ...(since !== undefined ? { since } : {}), limit: 200 });
  const pq = useLive("memory.facts.list", { status: ["proposed"] });
  const tq = useLive("memory.trail", { actor: "upkeep", limit: 200 });
  const aq = useLive("memory.page.list", { kind: "agent" });
  const all: readonly Item[] = lq.status === "ready" ? (lq.data.items as Item[]) : [];
  const shown = filterLearned(all, by);
  const proposed = (pq.status === "ready" ? pq.data.facts : []) as KFact[];
  const trail = tq.status === "ready" ? tq.data.rows : [];
  const agentPages = aq.status === "ready" ? aq.data.pages : [];
  const active = win !== 7 || by.size > 0;
  const failed = readError(lq, "Could not read what was learned");

  const counts = new Map<string, number>();
  for (const x of all) counts.set(byKey(x), (counts.get(byKey(x)) ?? 0) + 1);
  if (!counts.has("upkeep")) counts.set("upkeep", 0);
  const label = (id: string): string => (id === "upkeep" ? "Upkeep" : capital(who(id)));

  const filterEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [{ head: "Window" }];
    for (const w of WINDOWS) out.push({ label: w.label, checked: win === w.days, onSelect: () => setWin(w.days) });
    out.push({ head: "Learned by" });
    const ids = [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || label(a).localeCompare(label(b)));
    for (const id of ids) out.push({ label: label(id), checked: by.has(id), count: counts.get(id)!, onSelect: () => setBy((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }) });
    out.push({ separator: true }, { label: "Show all", onSelect: clear });
    return out;
  };
  const agentEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [{ head: "An agent's own memory" }];
    for (const a of data.agents) {
      const page = agentPages.find((p) => p.agentId === a.id || p.title === a.name);
      out.push({ label: a.name, onSelect: () => { if (page) nav.go({ v: "page", pageId: page.pageId }); else setBy(new Set([a.id])); } });
    }
    return out;
  };
  function clear(): void { setWin(7); setBy(new Set()); }

  const undo = (f: KFact): void => {
    doing.run("Could not undo the fact", () => undoFact(data, f.factId), () => ({
      text: "Moved to Trash.",
      undo: () => doing.run("Could not restore the fact", () => restoreFact(data, f.factId), () => ({ text: "Restored." })),
    }));
  };
  const startEdit = (f: KFact): void => { setEditing(f.factId); setDraft(f.text); };
  const save = (f: KFact): void => {
    const text = draft.trim();
    if (text === f.text) { setEditing(null); return; }
    if (text === "") { doing.run("Could not save the fact", () => Promise.reject(new Error("A fact cannot be empty")), () => null); return; }
    setEditing(null);
    doing.run("Could not save the fact", () => correctFact(data, f.factId, text), () => ({ text: "Saved. The old wording is kept in history." }));
  };
  const accept = (f: KFact): void => doing.run("Could not accept the fact", () => acceptFact(data, f.factId), () => ({ text: `Accepted. It is now in ${lands(f)}.` }));
  const reject = (f: KFact): void => doing.run("Could not reject the fact", () => rejectFact(data, f.factId), () => ({ text: "Rejected. It is closed off and kept in history." }));
  const openPage = (f: KFact): void => { if (f.subject) nav.go({ v: "page", pageId: f.subject.pageId, hl: f.factId }); };

  const factMenu = (f: KFact): MenuEntry[] => [
    { label: "Undo", onSelect: () => undo(f) }, { label: "Edit", onSelect: () => startEdit(f) }, { separator: true },
    ...(f.subject ? [{ label: "Open page", onSelect: () => openPage(f) }] : []),
    { label: "Open source", onSelect: () => openSourceOf(nav, f) }, { label: "Copy fact", onSelect: () => copyText(f.text) },
  ];

  const rows = (x: Item): ReactElement => {
    if (x.actorKind === "upkeep") {
      const f = x.fact;
      const t = trail.find((r) => r.factId === f.factId && r.at === x.at);
      const said = typeof t?.detail?.text === "string" ? (t.detail.text as string) : `${f.subject?.title ? `${f.subject.title}: ` : ""}${f.text}`;
      const reason = t?.reason ?? f.trashReason;
      return (
        <KRow
          key={`up-${f.factId}-${x.at}`} testID={`upkeep-${f.factId}`} label={`Upkeep ${x.from === "flag" ? "flagged" : "merged"} ${said}`} hollow
          onOpen={f.subject ? () => openPage(f) : () => nav.go({ v: "history" })}
          menu={() => [...(f.subject ? [{ label: "Open page", onSelect: () => openPage(f) }] : []), { label: "Open History", onSelect: () => nav.go({ v: "history", ...(f.subject ? { pageId: f.subject.pageId } : {}) }) }]}
          main={<Text style={{ fontSize: 14, lineHeight: 22, color: "var(--ink)" }}><Subject name="Upkeep" plain />{`${x.from === "flag" ? "flagged" : "merged"} ${said}`}</Text>}
          meta={<MetaLine parts={[...(reason ? [reason] : []), stampText(x.at, now)]} />}
          actions={<TextButton label="Open" testID={`open-${f.factId}`} onPress={f.subject ? () => openPage(f) : () => nav.go({ v: "history" })} />}
        />
      );
    }
    const f = x.fact;
    const live = editing === f.factId;
    return (
      <FactRow
        key={`${f.factId}-${x.at}`} fact={f} testID={`learned-${f.factId}`} menu={() => factMenu(f)} onOpen={() => openPage(f)} keys={{ e: () => startEdit(f), u: () => undo(f) }}
        meta={[capital(learnedLine(x, who)), stampText(x.at, now)]}
        {...(live ? { editing: { draft, onDraft: setDraft, onCancel: () => setEditing(null), onSave: () => save(f) } } : {})}
        actions={<><TextButton label="Undo" testID={`undo-${f.factId}`} a11y={`Undo: ${f.text}`} onPress={() => undo(f)} /><TextButton label="Edit" testID={`edit-${f.factId}`} a11y={`Edit: ${f.text}`} onPress={() => startEdit(f)} /></>}
      />
    );
  };

  const groups = groupByDay(shown, (x) => x.at, now);
  const body: ReactElement[] = [];
  for (const g of groups) body.push(<View key={g.label} testID={`group-${g.label}`} accessibilityRole="list" accessibilityLabel={g.label}><DayHead label={g.label} count={g.items.length} />{each(g.items, rows)}</View>);

  const waiting: ReactElement[] = each(proposed, (f) => (
    <FactRow
      key={f.factId} fact={f} testID={`proposed-${f.factId}`} always onOpen={() => openPage(f)}
      menu={() => [{ label: "Accept", onSelect: () => accept(f) }, { label: "Reject", onSelect: () => reject(f) }, { separator: true }, ...(f.subject ? [{ label: "Open page", onSelect: () => openPage(f) }] : []), { label: "Open source", onSelect: () => openSourceOf(nav, f) }, { label: "Copy fact", onSelect: () => copyText(f.text) }]}
      meta={[`${capital(f.by ? who(f.by) : "An agent")} proposed it for ${lands(f)}`, stampText(f.learnedAt, now)]}
      actions={<><TextButton accent label="Accept" testID={`accept-${f.factId}`} a11y={`Accept: ${f.text}`} onPress={() => accept(f)} /><TextButton label="Reject" testID={`reject-${f.factId}`} a11y={`Reject: ${f.text}`} onPress={() => reject(f)} /></>}
    />
  ));

  const right = (
    <>
      <QuietButton icon="filter" label="Filter" lit={active} testID="learned-filter" onPress={(x, y) => menu.show(filterEntries(), x, y, "other")} />
      <QuietButton icon="layers" label="By agent" testID="learned-by-agent" onPress={(x, y) => menu.show(agentEntries(), x, y, "other")} />
    </>
  );
  const bannerText = learnedBanner(win, each([...by], label), shown.length);

  return (
    <View style={frame.main} testID="know-learned">
      <KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Learned" }]} right={right} />
      <KnowColumn
        testID="know-learned-body" label="Learned" title="Learned"
        lede="What Vyre picked up from chats, runs and records. Undo or Edit any of it."
      >
        <Flash flash={doing.flash} onClose={() => doing.setFlash(null)} />
        <ErrorLine text={doing.err ?? failed} />
        {active ? <FilterBanner text={bannerText} onClear={clear} /> : null}
        {waiting.length > 0 ? <View testID="learned-waiting"><SectionHead title="Waiting for review" sub={`${waiting.length} waiting`} />{waiting}</View> : null}
        {body}
        {groups.length === 0 && lq.status === "ready" ? <Empty title="Nothing new in this window" text="Try a longer window, or clear the filter." /> : null}
        {lq.status === "loading" && !failed ? <Text style={{ marginTop: 24, fontSize: 13, color: "var(--ink-3)" }} accessibilityRole="progressbar">Loading</Text> : null}
      </KnowColumn>
      {menu.element}
    </View>
  );
}
