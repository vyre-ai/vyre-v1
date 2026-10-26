// The Home place (spec 3.1, ARCH 7.1): your day on one calm page. Greeting, then Needs you (top 3), My work, Projects at risk, While you were away, and today's routines.
// Sections A (this packet) are in ./sections-a; the Today, Starred, first-run checklist and Ask box sections of P-L9b_02 slot in through `top` and `bottom`.
// The shell provides the data (replica hooks, calls, navigation) through HomeDataProvider; without it the place draws its loading frame, the size of the real page.
import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  AwayDigest, HomeDataProvider, HomeLineProvider, MyWork, NEEDS_SCREEN, NeedsYouTop3, ProjectsAtRisk, RoutinesToday, SelectionProvider, WORK_SCREEN,
  dateLine, dayNumber, firstName, greeting, summaryBits, useHomeData, useHomeLine, useOnline, useOptionalHomeData, useScreenQuery, useSelection,
} from "./sections-a/index.ts";
import type { HomeData } from "./sections-a/index.ts";
import { Glyph, LinkButton, Section, SectionHeader, Skeleton } from "./sections-a/parts.tsx";
import type { CapMap } from "../../../../../generated/types.ts";

export { HomeDataProvider } from "./sections-a/index.ts";
export type { HomeData, HomeNav } from "./sections-a/index.ts";

type NeedsOut = CapMap["tasks.needs_you"]["out"];
type WorkOut = CapMap["tasks.my_work"]["out"];

/** A Personal Space lives on this computer only; the subtitle says so (prototype Home, Personal Space). */
export const PERSONAL_INTRO = "Your Personal Space, on this computer only";

function GreetingView({ sub }: { sub: string }): ReactElement {
  const data = useHomeData();
  const line = useHomeLine();
  const online = useOnline();
  const c = data.clock();

  // Cmd-Z (Ctrl-Z) takes back the latest change on the page
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && line.line) { e.preventDefault(); line.undo(); }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [line]);

  return (
    <View style={styles.hh} accessibilityRole="header">
      <Text accessibilityRole="header" aria-level={1} style={styles.h1}>{`${greeting(c)}, ${firstName(data.me.name)}`}</Text>
      <Text style={styles.hdate} testID="home-date">{sub}</Text>
      {online ? null : (
        <View style={styles.offline} testID="home-offline" accessibilityRole="status">
          <Glyph name="clock" size={13} />
          <Text style={styles.offlineText}>Offline, showing your saved copy</Text>
        </View>
      )}
      <View style={styles.lineSlot} accessibilityLiveRegion="polite">
        {line.line ? (
          <View style={styles.line} testID="home-line">
            <View style={styles.lineDot} />
            <Text style={styles.lineText}>{line.line.text}</Text>
            <LinkButton label="Undo" onPress={line.undo} testID="home-line-undo" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Greeting(): ReactElement {
  const data = useHomeData();
  const needs = useScreenQuery<NeedsOut>(NEEDS_SCREEN, "items", { limit: 3 });
  const work = useScreenQuery<WorkOut>(WORK_SCREEN, "list", { section: "open" });
  const c = data.clock();
  const today = dayNumber(c.now, c.offsetMin);
  const tasks = work.status === "ready" ? work.data.tasks : [];
  const dueToday = tasks.filter((t) => t.due !== undefined && dayNumber(t.due, c.offsetMin) === today).length;
  const overdue = tasks.filter((t) => t.due !== undefined && dayNumber(t.due, c.offsetMin) < today).length;
  const bits = summaryBits(needs.status === "ready" ? needs.data.total : 0, dueToday, overdue);
  const calm = needs.status === "ready" && work.status === "ready" && bits.length === 0;
  return <GreetingView sub={`${dateLine(c)}${bits.length ? ` · ${bits.join(", ")}` : calm ? " · Nothing is waiting on you" : ""}`} />;
}

function PersonalGreeting(): ReactElement {
  const data = useHomeData();
  return <GreetingView sub={`${dateLine(data.clock())} · ${PERSONAL_INTRO}`} />;
}

function Page({ top, bottom, personal }: { top?: ReactNode; bottom?: ReactNode; personal?: boolean }): ReactElement {
  const sel = useSelection();
  if (personal) {
    // A Personal Space is the assistant and the checklist only: Needs you, My work, Projects at risk, While you were away and Routines need a team, so they are not drawn.
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" testID="home-place">
        <Pressable accessible={false} onPress={() => sel.select(null)} style={styles.col}>
          <PersonalGreeting />
          {top}
          {bottom}
        </Pressable>
      </ScrollView>
    );
  }
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" testID="home-place">
      <Pressable accessible={false} onPress={() => sel.select(null)} style={styles.col}>
        <Greeting />
        {top}
        <NeedsYouTop3 />
        <MyWork />
        <ProjectsAtRisk />
        <AwayDigest />
        <RoutinesToday />
        {bottom}
      </Pressable>
    </ScrollView>
  );
}

/** The page frame before data arrives: the same column and section heads with rows of the real height, so nothing moves when the data lands. */
export function HomeLoading(): ReactElement {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} testID="home-loading">
      <View style={styles.col}>
        <View style={styles.hh}><Text style={styles.h1}>Home</Text></View>
        <Section id="s-needs" first><SectionHeader id="needs" title="Needs you" /><Skeleton rows={3} id="needs" /></Section>
        <Section id="s-work"><SectionHeader id="work" title="My work" /><Skeleton rows={4} id="work" /></Section>
      </View>
    </ScrollView>
  );
}

export interface HomeProps {
  place?: string;
  /** Overrides what the shell provided (the screenshot mounts and tests pass their own). */
  data?: HomeData;
  /** Above Needs you: the first-run checklist (P-L9b_02). */
  top?: ReactNode;
  /** Below the routines: Today, Starred and the Ask box (P-L9b_02). */
  bottom?: ReactNode;
  /** A Personal Space: the personal greeting, the checklist and the lower sections only (empty sections are not drawn). */
  personal?: boolean;
}

export default function Home({ data, top, bottom, personal }: HomeProps): ReactElement {
  const provided = useOptionalHomeData();
  const d = data ?? provided;
  if (!d) return <HomeLoading />;
  return (
    <HomeDataProvider value={d}>
      <HomeLineProvider>
        <SelectionProvider>
          <Page top={top} bottom={bottom} personal={personal === true} />
        </SelectionProvider>
      </HomeLineProvider>
    </HomeDataProvider>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "var(--win)" as string },
  scrollContent: { flexGrow: 1 },
  col: { width: "100%", maxWidth: 780, alignSelf: "center", paddingTop: 34, paddingHorizontal: 28, paddingBottom: 40 },
  hh: { marginBottom: 24 },
  h1: { margin: 0, fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.6, color: "var(--ink)" as string },
  hdate: { marginTop: 5, fontSize: 14, lineHeight: 20, color: "var(--ink-2)" as string },
  offline: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  offlineText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  lineSlot: { position: "absolute", right: 0, top: 8 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, height: 24 },
  lineDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: "var(--ok)" as string },
  lineText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
