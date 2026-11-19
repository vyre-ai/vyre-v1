// The Logs tab of a site: its app, its requests, its builds and its jobs in one live list, with search, source, deploy, level and time, a pause, and copy.
// Live follows new lines every second and a half and stays at the newest unless the person scrolled up; a search or a time window is a look at the past and does not move. A cut log says how
// much was left out. Times are in the Space's time.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { MenuIcon } from "../../../../../../../ui/src/Menu/index.tsx";
import { useSpaceZone } from "../../../../../../../ui/src/Time/index.tsx";
import { deviceZone } from "../../../../../../../lib/zones.ts";
import { useAppsData } from "../data.tsx";
import { MenuButton } from "./parts.tsx";
import {
  LEVEL_CHOICES,
  NO_FILTER,
  SOURCE_CHOICES,
  WINDOW_CHOICES,
  asText,
  countWord,
  following,
  merge,
  readInput,
  rows,
} from "./ops-model.ts";
import type { Filters, LogLine } from "./ops-model.ts";

const POLL_MS = 1500;
const PAUSE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="4" y="3" width="2.6" height="10" rx="1"/><rect x="9.4" y="3" width="2.6" height="10" rx="1"/></svg>`;
const PLAY = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z"/></svg>`;
const COPY = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 3.5v-.4a1.6 1.6 0 0 0-1.6-1.6H3.1a1.6 1.6 0 0 0-1.6 1.6v5.8a1.6 1.6 0 0 0 1.6 1.6h.4"/></svg>`;

interface ScopeOut {
  scope: string;
  source: string;
  title: string;
  at: number;
  lines: number;
}
interface Read {
  lines: LogLine[];
  leftOut?: string;
  lastSeq: number;
  scopes: ScopeOut[];
}

export function SiteLogs({ siteId, height = 520 }: { siteId: string; height?: number }): ReactElement {
  const d = useAppsData();
  const zone = useSpaceZone() ?? deviceZone();
  // on a phone the line is the time, the words and the status; the source and the milliseconds are left out so a path is not broken over four lines
  const narrow = useWindowDimensions().width < 600;
  const [f, setF] = useState<Filters>(NO_FILTER);
  const [typed, setTyped] = useState("");
  const [paused, setPaused] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [leftOut, setLeftOut] = useState<string | null>(null);
  const [scopes, setScopes] = useState<ScopeOut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const last = useRef(0);
  const follow = following(f, paused);

  // what is typed reaches the read a moment after the last key
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.q === typed ? x : { ...x, q: typed })), 250);
    return () => clearTimeout(t);
  }, [typed]);

  // a new look: the filters changed, so the list is read again from the start
  useEffect(() => {
    let live = true;
    setLoaded(false);
    void (d.call("sites.logs_read", readInput(siteId, f, d.clock().now)) as Promise<Read>).then(
      (o) => {
        if (!live) return;
        setLines(o.lines);
        setLeftOut(o.leftOut ?? null);
        setScopes(o.scopes);
        last.current = o.lastSeq;
        setError(null);
        setLoaded(true);
      },
      (e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "The log could not be read.");
        setLoaded(true);
      },
    );
    return () => {
      live = false;
    };
  }, [d, siteId, f]);

  // following: what came after the newest line shown
  useEffect(() => {
    if (!follow || !loaded) return undefined;
    let live = true;
    let busy = false;
    const t = setInterval(() => {
      if (busy) return;
      busy = true;
      void (d.call("sites.logs_read", readInput(siteId, f, d.clock().now, last.current)) as Promise<Read>)
        .then((o) => {
          if (!live) return;
          last.current = Math.max(last.current, o.lastSeq);
          if (o.lines.length > 0) setLines((prev) => merge(prev, o.lines));
          setScopes(o.scopes);
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [d, siteId, f, follow, loaded]);

  const shown = useMemo(() => rows(lines, zone), [lines, zone]);
  const ref = useRef<ScrollView | null>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    if (atEnd.current) ref.current?.scrollToEnd({ animated: false });
  }, [shown.length]);

  const scopeTitle = f.scope ? (scopes.find((x) => x.scope === f.scope)?.title ?? "This one") : "Every deploy";
  const status = paused
    ? "Paused"
    : follow
      ? "Following"
      : f.q.trim()
        ? "Showing what matches"
        : `Showing ${(WINDOW_CHOICES.find((w) => w.key === f.window)?.title ?? "").toLowerCase()}`;

  return (
    <View style={[s.wrap, { height }]} testID="site-logs-tab">
      <View style={s.bar}>
        <TextInput
          accessibilityLabel="Search the log"
          testID="site-log-search"
          value={typed}
          onChangeText={setTyped}
          placeholder="Search the log"
          placeholderTextColor="var(--ink-4)"
          autoCapitalize="none"
          autoCorrect={false}
          style={s.search}
        />
        <MenuButton
          title={SOURCE_CHOICES.find((x) => x.key === f.source)?.title ?? "All sources"}
          testID="site-log-source"
          entries={SOURCE_CHOICES.map((x) => ({
            label: x.title,
            checked: x.key === f.source,
            onSelect: () => setF({ ...f, source: x.key }),
          }))}
        />
        {scopes.length > 1 ? (
          <MenuButton
            title={scopeTitle}
            testID="site-log-scope"
            search="Find a deploy"
            entries={[
              { label: "Every deploy", checked: f.scope === "", onSelect: () => setF({ ...f, scope: "" }) },
              ...scopes.map((x) => ({
                label: x.title,
                checked: f.scope === x.scope,
                onSelect: () => setF({ ...f, scope: x.scope }),
              })),
            ]}
          />
        ) : null}
        <MenuButton
          title={LEVEL_CHOICES.find((x) => x.key === f.level)?.title ?? "Everything"}
          testID="site-log-level"
          entries={LEVEL_CHOICES.map((x) => ({
            label: x.title,
            checked: x.key === f.level,
            onSelect: () => setF({ ...f, level: x.key }),
          }))}
        />
        <MenuButton
          title={WINDOW_CHOICES.find((x) => x.key === f.window)?.title ?? "Live"}
          testID="site-log-window"
          entries={WINDOW_CHOICES.map((x) => ({
            label: x.title,
            checked: x.key === f.window,
            onSelect: () => setF({ ...f, window: x.key }),
          }))}
        />
        <View style={s.grow} />
        <Text style={s.count} testID="site-log-count">
          {countWord(lines.length)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={paused ? "Follow the log" : "Pause the log"}
          testID="site-log-pause"
          onPress={() => setPaused(!paused)}
          style={[s.icon, paused && s.iconOn]}
        >
          <MenuIcon icon={paused ? PLAY : PAUSE} color={paused ? "var(--accent)" : "var(--ink-3)"} size={14} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "Copied" : "Copy what is shown"}
          testID="site-log-copy"
          onPress={() => {
            try {
              void navigator.clipboard?.writeText(asText(lines, zone));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* no clipboard here */
            }
          }}
          style={s.icon}
        >
          <MenuIcon icon={COPY} color="var(--ink-3)" size={14} />
        </Pressable>
      </View>
      {error ? (
        <Text style={s.empty}>{error}</Text>
      ) : (
        <ScrollView
          ref={ref}
          style={s.list}
          testID="site-logs"
          scrollEventThrottle={64}
          onScroll={(e) => {
            const n = e.nativeEvent;
            atEnd.current = n.contentOffset.y + n.layoutMeasurement.height >= n.contentSize.height - 24;
          }}
        >
          {leftOut ? <Text style={s.cut}>{leftOut}</Text> : null}
          {!loaded ? <Text style={s.empty}>Reading the log…</Text> : null}
          {loaded && shown.length === 0 ? (
            <Text style={s.empty}>{f.q.trim() ? "No line has that." : "Nothing logged yet."}</Text>
          ) : null}
          {/* ui-rows-lint: not a list (the lines of a log) */}
          {shown.map((r) => (
            <View key={r.seq} style={[s.row, r.tone === "error" && s.rowError]} testID="site-log-row">
              <Text style={[s.cell, s.time]}>{r.more ? "" : r.time}</Text>
              {narrow ? null : <Text style={[s.cell, s.tag]}>{r.more ? "" : r.tag}</Text>}
              <Text selectable style={[s.cell, s.text, r.tone === "error" && s.err, r.tone === "warn" && s.warn]}>
                {r.text}
              </Text>
              {r.status !== undefined ? (
                <Text style={[s.cell, s.status, r.status >= 500 ? s.err : r.status < 400 ? s.ok : null]}>
                  {r.status}
                </Text>
              ) : null}
              {r.ms !== undefined && !narrow ? <Text style={[s.cell, s.ms]}>{r.ms}</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}
      <View style={s.foot}>
        <View style={[s.dot, follow && s.dotOn]} />
        <Text style={s.footText} testID="site-log-status">
          {status}
        </Text>
      </View>
    </View>
  );
}

const mono = "var(--mono)" as string;
const s = StyleSheet.create({
  wrap: {
    minHeight: 320,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    overflow: "hidden",
    backgroundColor: "var(--sunk)" as string,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "var(--line)" as string,
    backgroundColor: "var(--win)" as string,
  },
  search: {
    minWidth: 180,
    flexGrow: 1,
    flexBasis: 200,
    maxWidth: 320,
    height: 30,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: "var(--ink)" as string,
    backgroundColor: "var(--field)" as string,
  },
  grow: { flexGrow: 1 },
  count: { fontSize: 12, color: "var(--ink-3)" as string, marginRight: 4 },
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  iconOn: { backgroundColor: "var(--sel)" as string },
  list: { flex: 1 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 12, minHeight: 21 },
  rowError: { backgroundColor: "rgba(240,106,106,0.10)" },
  cell: { fontFamily: mono, fontSize: 11.5, lineHeight: 21, color: "var(--ink-2)" as string },
  time: { width: 62, color: "var(--ink-4)" as string },
  tag: { width: 34, color: "var(--ink-3)" as string },
  text: { flex: 1, minWidth: 0 },
  status: { width: 34, textAlign: "right" },
  ms: { width: 60, textAlign: "right", color: "var(--ink-3)" as string },
  err: { color: "var(--danger)" as string },
  warn: { color: "var(--warn)" as string },
  ok: { color: "var(--ok)" as string },
  cut: { fontSize: 11.5, color: "var(--ink-4)" as string, padding: 10, fontFamily: mono },
  empty: { fontSize: 13, color: "var(--ink-3)" as string, padding: 16 },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderColor: "var(--line)" as string,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  dotOn: { backgroundColor: "var(--accent)" as string },
  footText: { fontSize: 12, color: "var(--ink-3)" as string },
});
