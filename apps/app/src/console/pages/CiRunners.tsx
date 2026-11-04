// Console > Computers > CI runners: a Space runs its GitHub checks on throwaway machines in its own cloud account. Off: what it is and Turn on. On: the month's cost against the cap,
// the recent runs (each opens a sheet), the cleanup log, the settings and the safety rules. Admins only (connectors.manage).
// Reads ci.settings.get, ci.cost.month, ci.runs.list (per repository) and ci.runs.get; writes ci.settings.set (turn on, turn off, every setting, raise the cap).
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { WarnTile } from "./overview/Overview.tsx";
import type { CapMap } from "../../../../../generated/types.ts";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Dot, Glyph } from "../shell/glyphs.tsx";
import { ago } from "../shell/format.ts";
import { Group, Lead, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, FormSheet, Note, ReadState, useAction, useRead } from "./shared.tsx";

export type CiSettings = CapMap["ci.settings.get"]["out"];
export type CiCost = CapMap["ci.cost.month"]["out"];
export type CiRun = CapMap["ci.runs.list"]["out"]["runs"][number];
export type Pick = { key: string; title: string };

export const REGIONS: readonly Pick[] = [{ key: "nyc3", title: "New York (nyc3)" }, { key: "sfo3", title: "San Francisco (sfo3)" }, { key: "fra1", title: "Frankfurt (fra1)" }, { key: "sgp1", title: "Singapore (sgp1)" }];
export const SIZES: readonly Pick[] = [{ key: "s-2vcpu-4gb", title: "2 vCPU, 4 GB" }, { key: "s-4vcpu-8gb", title: "4 vCPU, 8 GB" }, { key: "s-8vcpu-16gb", title: "8 vCPU, 16 GB" }];
export const MOST_AT_ONCE: readonly number[] = [1, 2, 3, 5, 8];
export const MINUTES: readonly number[] = [10, 20, 30, 60, 120];
export const CAPS: readonly number[] = [4, 25, 50, 100, 250];
const FIELD_WORDS: Readonly<Record<string, string>> = { region: "Region", size: "Machine size", maxConcurrent: "Most at once", maxJobMinutes: "Time limit per job", monthlyCapUsd: "Monthly cap" };

/** "$4.12", "$50": cents only when there are some. */
export const dollars = (n: number): string => `$${n.toFixed(2).replace(/\.00$/, "")}`;
const NB = "\u00a0";
/** "3 m 48 s", "58 s": how long a job ran. A number and its unit never split across lines. */
export function durationWord(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}${NB}s` : `${Math.floor(s / 60)}${NB}m${NB}${String(s % 60).padStart(2, "0")}${NB}s`;
}
/** The days a month has in the books: "2026-11" reads "1 Nov". */
export function sinceWord(month: string): string {
  const m = Number(month.slice(5, 7));
  return `1 ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "this month"}`;
}
/** The start of today, in UTC, the way the server counts a day. */
export const dayStart = (now: number): number => now - (now % 86_400_000);
/** Only the runs queued today. */
export const runsToday = (list: readonly CiRun[], now: number): CiRun[] => list.filter((r) => r.queuedAt >= dayStart(now));
const BREAKDOWN_ORDER = ["Failed", "Passed", "Stopped", "Running", "Waiting", "Not run"] as const;
/** The runs of today by state; the parts always add up to the total. */
export function todayBreakdown(today: readonly CiRun[]): { total: number; parts: Array<{ word: string; n: number }>; line: string } {
  const parts = BREAKDOWN_ORDER.map((word) => ({ word, n: today.filter((r) => runWord(r).word === word).length })).filter((p) => p.n > 0);
  return { total: today.length, parts, line: parts.length === 0 ? "Nothing yet today" : parts.map((p) => `${p.n} ${p.word.toLowerCase()}`).join(", ") };
}
/** The longest of today's runs, nothing when no run of today has started. */
export function longestToday(today: readonly CiRun[], now: number): number | undefined {
  const lens = today.map((r) => runLength(r, now)).filter((n): n is number => n !== undefined);
  return lens.length === 0 ? undefined : Math.max(...lens);
}
/** A job reads "workflow · job" when GitHub named it "workflow / job". */
export const runTitle = (jobName: string): string => jobName.replace(/\s+\/\s+/, " · ");
/** How long a run took: from start to end, or to now while it runs; nothing while it waits. */
export const runLength = (r: CiRun, now: number): number | undefined => (r.startedAt == null ? undefined : (r.endedAt ?? now) - r.startedAt);

/** The state of a run in a word and a tone. */
export function runWord(r: CiRun): { word: string; tone: "ok" | "warn" | "bad" | "off" } {
  switch (r.state) {
    case "queued": return { word: "Waiting", tone: "off" };
    case "starting": case "running": return { word: "Running", tone: "warn" };
    case "finished": return r.conclusion === "success" ? { word: "Passed", tone: "ok" } : r.conclusion === "failure" ? { word: "Failed", tone: "bad" } : { word: "Stopped", tone: "warn" };
    case "failed": return { word: "Failed", tone: "bad" };
    case "swept": return { word: "Stopped", tone: "warn" };
    default: return { word: "Not run", tone: "off" };
  }
}
export const runUrl = (r: CiRun): string => `https://github.com/${r.repo}/actions/runs/${r.workflowRunId}/job/${r.jobId}`;
const open = (url: string): void => { (globalThis as { open?: (u: string, t: string, f: string) => unknown }).open?.(url, "_blank", "noopener,noreferrer"); };

/** The next cap up that clears what the month has cost. */
export const raisedCap = (spent: number, cap: number): number => CAPS.find((c) => c > spent && c > cap) ?? Math.max(cap, Math.ceil(spent)) * 2;
export const isPaused = (s: CiSettings, cost?: CiCost): boolean => s.settings.enabled && cost !== undefined && (cost.paused || (cost.capUsd > 0 && cost.spentUsd >= cost.capUsd));

/** The choices of one setting as menu entries: the current one is checked, a pick calls onPick with the value. */
export function pickEntries<T extends string | number>(options: readonly { value: T; title: string }[], current: T, onPick: (value: T) => void): MenuEntry[] {
  const all = options.some((o) => o.value === current) ? options : [{ value: current, title: String(current) }, ...options];
  return all.map((o) => ({ label: o.title, checked: o.value === current, onSelect: () => onPick(o.value) }));
}
/** The entries for each setting; a value the Space already has stays on the list even when it is not one of the usual choices. */
export function settingEntries(field: "region" | "size" | "maxConcurrent" | "maxJobMinutes" | "monthlyCapUsd", current: string | number, spent: number, onPick: (value: never) => void): MenuEntry[] {
  const pick = onPick as (v: unknown) => void;
  if (field === "region") return pickEntries(REGIONS.map((o) => ({ value: o.key, title: o.title })), String(current), pick);
  if (field === "size") return pickEntries(SIZES.map((o) => ({ value: o.key, title: o.title })), String(current), pick);
  if (field === "maxConcurrent") return pickEntries(MOST_AT_ONCE.map((n) => ({ value: n, title: String(n) })), Number(current), pick);
  if (field === "maxJobMinutes") return pickEntries(MINUTES.map((n) => ({ value: n, title: `${n} min` })), Number(current), pick);
  return pickEntries(CAPS.map((n) => ({ value: n, title: n <= spent ? `${dollars(n)} (below this month's cost, CI pauses now)` : dollars(n) })), Number(current), pick);
}
const titleOf = (list: readonly Pick[], key: string): string => list.find((o) => o.key === key)?.title ?? key;

function PickButton({ value, entries, testID, label }: { value: string; entries: MenuEntry[]; testID: string; label: string }): ReactElement {
  const menu = useMenu();
  const ref = useRef<unknown>(null);
  return <><Pressable ref={(r) => { ref.current = r; }} accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={() => { const box = (ref.current as { getBoundingClientRect?: () => { left: number; bottom: number } } | null)?.getBoundingClientRect?.(); menu.show(entries, box?.left ?? 0, (box?.bottom ?? 0) + 4, "other", { label }); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 }}><Text style={{ fontSize: 13, color: "var(--ink)" as string }}>{value}</Text><Glyph name="chevD" size={10} color="var(--ink-3)" /></Pressable>{menu.element}</>;
}

function Stat({ word, tone, id }: { word: string; tone: "ok" | "warn" | "bad" | "off"; id: string }): ReactElement {
  return <View testID={id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Dot tone={tone} size={7} /><Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>{word}</Text></View>;
}

/** The line that says the Space's GitHub app is missing or needs new permissions, with the way to fix it. Nothing when it is fine. */
export function GithubAppLine({ settings, top = 0 }: { settings: CiSettings; top?: number }): ReactElement | null {
  const data = useConsoleData();
  const g = settings.githubApp;
  if (g.ready) return null;
  if (!g.installed) return <View style={{ marginTop: top }}><Group><Row id="ci-github-missing" title={`${data.space.name} has no GitHub app installed yet`} note="Jobs stay on GitHub's own runners until it is." trailing={<Button label="Set up GitHub" testID="ci-github-setup" onPress={() => data.nav.openPage("ghapp")} />} onPress={() => data.nav.openPage("ghapp")} /></Group></View>;
  const url = g.acceptUrl ?? g.orgAcceptUrl;
  return <View style={{ marginTop: top }}><Group><Row id="ci-github-perms" title={`${data.space.name}'s GitHub app needs new permissions`} note="Until you accept them, jobs stay on GitHub's own runners." trailing={url ? <Button label="Accept on GitHub" testID="ci-github-accept" onPress={() => open(url)} /> : undefined} /></Group></View>;
}

/** The square tile behind a row's icon: 30 wide, a quiet wash, or a tone's wash. */
export function IconTile({ icon, tone, size = 30 }: { icon: string; tone?: "ok" | "warn" | "bad"; size?: number }): ReactElement {
  const color = tone === "bad" ? "var(--danger)" : tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--ink-3)";
  const wash = tone === "bad" ? "var(--bad-wash, rgba(214, 69, 65, 0.13))" : tone === "ok" ? "var(--ok-wash, rgba(46, 160, 100, 0.14))" : tone === "warn" ? "var(--warn-wash, rgba(214, 140, 30, 0.15))" : "var(--sunk)";
  return <Lead><View testID={`icon-tile-${icon}`} style={{ width: size, height: size, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: wash as string }}><Glyph name={icon} size={size >= 30 ? 16 : 15} color={color} /></View></Lead>;
}

/** The cloud accounts in Vault as menu entries: the current one is checked; the last entry goes to Vault to add one. */
export function accountEntries(list: readonly { name: string; handle: string }[], current: string, onPick: (handle: string) => void, addInVault: () => void): MenuEntry[] {
  return [...list.map((i) => ({ label: i.name, checked: i.handle === current, onSelect: () => onPick(i.handle) })), { label: "Add one in Vault…", onSelect: addInVault }];
}
/** The account as a person reads it: the Vault item's name and where the key lives, not its handle. */
export const accountWord = (list: readonly { name: string; handle: string }[], ref: string | null): string => {
  if (!ref) return "Not set";
  const hit = list.find((i) => i.handle === ref);
  return hit ? `${hit.name} (Vault)` : ref;
};

function StatTile({ id, icon, label, big, sub, warn = false, children }: { id: string; icon: string; label: string; big: string; sub: string; warn?: boolean; children?: ReactElement }): ReactElement {
  return <View testID={id} accessibilityLabel={`${label}: ${big}`} style={{ flexGrow: 1, flexBasis: 150, minWidth: 140, minHeight: 92, padding: 12, gap: 4, borderRadius: 10, borderWidth: 1, borderColor: (warn ? "var(--warn)" : "var(--line)") as string, backgroundColor: "var(--raised)" as string }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Glyph name={icon} size={14} color="var(--ink-3)" /><Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{label}</Text></View>
    <Text style={{ fontSize: 20, fontWeight: "600", color: "var(--ink)" as string, marginTop: 2 }}>{big}</Text>
    {children}
    <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{sub}</Text>
  </View>;
}

export function CiRunnersPage(): ReactElement {
  const data = useConsoleData();
  const settings = useRead<CiSettings>("ci.settings.get");
  const on = settings.data?.settings.enabled === true;
  const cost = useRead<CiCost>("ci.cost.month", {}, { enabled: on });
  const vault = useRead<CapMap["vault.items.list"]["out"]>("vault.items.list", { limit: 200 }, { enabled: on });
  const [runs, setRuns] = useState<CiRun[] | null>(null);
  const [rev, setRev] = useState(0);
  const [sheet, setSheet] = useState<"on" | "log" | { run: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const refresh = (): void => { settings.refresh(); cost.refresh(); setRev((n) => n + 1); };
  const action = useAction(refresh);
  const repos = (cost.data?.byRepo ?? []).map((r) => r.repo).join(",");
  useEffect(() => {
    if (!on || !cost.data) return undefined;
    let live = true;
    const list = repos === "" ? [] : repos.split(",");
    void Promise.all(list.map((repo) => data.call("ci.runs.list", { repo, limit: 50 }) as Promise<{ runs: CiRun[] }>)).then(
      (all) => { if (live) setRuns(all.flatMap((a) => a.runs).sort((a, b) => b.queuedAt - a.queuedAt)); },
      () => { if (live) setRuns([]); },
    );
    return () => { live = false; };
  }, [on, repos, rev, cost.data === undefined]);
  if (!settings.data) return <ReadState error={settings.error} retry={settings.refresh} />;
  const s = settings.data;
  const set = (input: Record<string, unknown>, done: string): Promise<unknown> => action.run("ci.settings.set", input, done);
  const now = data.clock().now;

  if (!on) {
    return <View testID="console-ci">
      <Group testID="ci-off">
        <View style={{ alignItems: "center", gap: 8, paddingVertical: 26, paddingHorizontal: 18 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sel)" as string }}><Glyph name="play" size={16} color="var(--accent)" /></View>
          <Text style={{ fontSize: 15, fontWeight: "600", color: "var(--ink)" as string }}>CI runners are off</Text>
          <Text style={{ fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center", maxWidth: 460, lineHeight: 19 }}>Run your GitHub checks on throwaway machines from your own cloud account. Nothing runs on people's computers.</Text>
          <View style={{ marginTop: 4 }}><Button label="Turn on" testID="ci-turn-on" onPress={() => setSheet("on")} /></View>
        </View>
      </Group>
      <View style={{ marginTop: 10, marginBottom: 4 }}><Text style={{ fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 2 }}>Each machine runs one job and is deleted afterwards. The cost shows here. GitHub minutes are never used, and the Space server never runs a job.</Text></View>
      <GithubAppLine settings={s} top={14} />
      {sheet === "on" ? <TurnOnSheet settings={s} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refresh(); }} /> : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </View>;
  }

  const c = cost.data;
  const paused = isPaused(s, c);
  const list = runs ?? [];
  const today = runsToday(list, now);
  const breakdown = todayBreakdown(today);
  const live = list.filter((r) => r.state === "starting" || r.state === "running").length;
  const longest = longestToday(today, now);
  const vaultItems = vault.data?.items ?? [];
  const swept = list.filter((r) => r.state === "swept");
  const pct = c && c.capUsd > 0 ? Math.min(100, Math.round((c.spentUsd / c.capUsd) * 100)) : 0;
  const cfg = s.settings;
  const key = (f: "region" | "size" | "maxConcurrent" | "maxJobMinutes" | "monthlyCapUsd") => (v: never) => void set({ [f]: v }, `${FIELD_WORDS[f]} saved`);

  return <View testID="console-ci">
    {paused && c ? <Section title="Needs you" count={1}><Group><Row id="ci-paused" title={`CI paused: this month's cap of ${dollars(c.capUsd)} is reached`} note="New jobs wait on GitHub's own runners. Admins were told." leading={<Lead><WarnTile icon="play" /></Lead>} trailing={<Button label="Raise cap" testID="ci-raise-cap" disabled={action.busy} onPress={() => void set({ monthlyCapUsd: raisedCap(c.spentUsd, c.capUsd) }, `Monthly cap is ${dollars(raisedCap(c.spentUsd, c.capUsd))}. CI runs again`)} />} /></Group></Section> : null}
    <GithubAppLine settings={s} />
    <View testID="ci-strip" style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
      <StatTile id="ci-month" icon="chart" label="This month" big={c ? `${dollars(c.spentUsd)} of ${dollars(c.capUsd)}` : "Reading the cost"} sub={c ? `${c.runs} ${c.runs === 1 ? "job" : "jobs"} since ${sinceWord(c.month)}` : ""} warn={paused}>
        <View testID="ci-bar" accessibilityLabel={`${pct} percent of the cap`} style={{ height: 6, borderRadius: 3, marginVertical: 3, backgroundColor: "var(--press)" as string }}><View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: (paused ? "var(--warn)" : "var(--accent)") as string }} /></View>
      </StatTile>
      <StatTile id="ci-today" icon="play" label="Runs today" big={String(breakdown.total)} sub={breakdown.line} />
      <StatTile id="ci-live" icon="server" label="Machines running now" big={String(live)} sub={`Up to ${cfg.maxConcurrent} at once`} />
      <StatTile id="ci-longest" icon="clock" label="Longest job today" big={longest === undefined ? "None yet" : durationWord(longest)} sub={`The limit is ${cfg.maxJobMinutes} min per job`} />
    </View>
    <Section title="Recent runs" count={list.length}>
      <Group>
        {list.length === 0 ? <Row id="ci-no-runs" title="No runs yet" note="Jobs from projects linked to a GitHub repo show here after their next run." /> : null}
        {list.slice(0, 20).map((r) => {
          const w = runWord(r); const len = runLength(r, now);
          const icon = w.word === "Failed" ? "xc" : w.word === "Passed" ? "ok" : "clock";
          return <Row key={r.runId} id={`ci-run-${r.runId}`} tall title={runTitle(r.jobName)} note={[r.repo, ago(now, r.queuedAt), len === undefined ? undefined : durationWord(len), r.note ?? undefined].filter(Boolean).join(" · ")} leading={<IconTile icon={icon} tone={w.tone === "bad" ? "bad" : w.tone === "ok" ? "ok" : "warn"} />} trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Stat id={`ci-run-state-${r.runId}`} word={w.word} tone={w.tone} /><Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>{dollars(r.costUsd)}</Text><Glyph name="chevR" size={12} color="var(--ink-3)" /></View>} onPress={() => setSheet({ run: r.runId })} />;
        })}
      </Group>
    </Section>
    <Section title="Cleanup">
      <Group>
        <Row id="ci-cleanup" title="Sweeper" note={swept[0] ? `${swept[0].note ?? "Removed a machine"}, ${ago(now, swept[0].endedAt ?? swept[0].queuedAt)}` : "Nothing has needed cleaning up"} leading={<IconTile icon="trash" />} trailing={<Button label="Details" testID="ci-cleanup-open" onPress={() => setSheet("log")} />} />
      </Group>
    </Section>
    <Section title="Settings">
      <Group>
        <Row id="ci-cloud" title="Cloud account" note="The key stays in Vault. Machines are created and deleted here" leading={<IconTile icon="key" />} trailing={<PickButton label="Cloud account" testID="ci-pick-account" value={accountWord(vaultItems, cfg.vaultKeyRef)} entries={accountEntries(vaultItems, cfg.vaultKeyRef ?? "", (handle) => void set({ vaultKeyRef: handle }, "Cloud account saved"), () => data.nav.openApp({ screen: "vault.layout" }))} />} />
        <Row id="ci-region" title="Region" leading={<IconTile icon="globe" />} trailing={<PickButton label="Region" testID="ci-pick-region" value={titleOf(REGIONS, cfg.region)} entries={settingEntries("region", cfg.region, 0, key("region"))} />} />
        <Row id="ci-size" title="Machine size" note="A short job costs about a cent" leading={<IconTile icon="cpu" />} trailing={<PickButton label="Machine size" testID="ci-pick-size" value={titleOf(SIZES, cfg.size)} entries={settingEntries("size", cfg.size, 0, key("size"))} />} />
        <Row id="ci-max" title="Most at once" note="More jobs wait in line" leading={<IconTile icon="play" />} trailing={<PickButton label="Most at once" testID="ci-pick-max" value={String(cfg.maxConcurrent)} entries={settingEntries("maxConcurrent", cfg.maxConcurrent, 0, key("maxConcurrent"))} />} />
        <Row id="ci-mins" title="Time limit per job" note="A job past this is stopped and its machine deleted" leading={<IconTile icon="clock" />} trailing={<PickButton label="Time limit per job" testID="ci-pick-mins" value={`${cfg.maxJobMinutes} min`} entries={settingEntries("maxJobMinutes", cfg.maxJobMinutes, 0, key("maxJobMinutes"))} />} />
        <Row id="ci-cap" title="Monthly cap" note="CI pauses when the month's cost reaches it" leading={<IconTile icon="card" />} trailing={<PickButton label="Monthly cap" testID="ci-pick-cap" value={dollars(cfg.monthlyCapUsd)} entries={settingEntries("monthlyCapUsd", cfg.monthlyCapUsd, c?.spentUsd ?? 0, key("monthlyCapUsd"))} />} />
      </Group>
    </Section>
    <Section title="Safety">
      <Group>
        <Row id="ci-safe-forks" title="Pull requests from outside the team" note="Never run where secrets are" leading={<IconTile icon="space" />} trailing={<Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>Always</Text>} />
        <Row id="ci-safe-machines" title="People's computers and the Space server" note="Never used for CI" leading={<IconTile icon="device" />} trailing={<Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>Always</Text>} />
      </Group>
    </Section>
    {confirmOff ? <Group><View testID="ci-off-confirm" style={{ padding: 12, gap: 10 }}>
      <Text style={{ fontSize: 13, color: "var(--ink)" as string }}>Turn off CI runners? Jobs already running finish first. New jobs go back to GitHub's own runners.</Text>
      <Actions><Button danger label="Turn off" testID="ci-off-yes" disabled={action.busy} onPress={() => void set({ enabled: false }, "CI runners are off").then(() => setConfirmOff(false))} /><Button label="Cancel" testID="ci-off-cancel" onPress={() => setConfirmOff(false)} /></Actions>
    </View></Group> : <Actions><Button danger label="Turn off CI runners…" testID="ci-turn-off" onPress={() => setConfirmOff(true)} /></Actions>}
    {action.note ? <Note>{action.note}</Note> : null}
    {typeof sheet === "object" && sheet !== null ? <RunSheet runId={sheet.run} now={now} onClose={() => setSheet(null)} /> : null}
    {sheet === "log" ? <CleanupSheet runs={swept} now={now} onClose={() => setSheet(null)} /> : null}
  </View>;
}

function Labeled({ label, children, help }: { label: string; children: ReactElement; help?: string }): ReactElement {
  return <View style={{ marginVertical: 8, gap: 6 }}><Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{label}</Text>{children}{help ? <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{help}</Text> : null}</View>;
}

/** The Turn on sheet: the cloud account from Vault, the region, machine size, limits and the monthly cap, then one Turn on that saves them all and starts the runners. */
export function TurnOnSheet({ settings, onClose, onDone }: { settings: CiSettings; onClose: () => void; onDone: () => void }): ReactElement {
  const data = useConsoleData();
  const items = useRead<CapMap["vault.items.list"]["out"]>("vault.items.list", { limit: 200 });
  const action = useAction(onDone);
  const cur = settings.settings;
  const [key, setKey] = useState<string>(cur.vaultKeyRef ?? "");
  const [region, setRegion] = useState(cur.region);
  const [size, setSize] = useState(cur.size);
  const [max, setMax] = useState(cur.maxConcurrent);
  const [mins, setMins] = useState(cur.maxJobMinutes);
  const [cap, setCap] = useState(cur.monthlyCapUsd > 0 ? cur.monthlyCapUsd : 50);
  const list = items.data?.items ?? [];
  const accounts = accountEntries(list, key, setKey, () => data.nav.openApp({ screen: "vault.layout" }));
  const keyName = list.find((i) => i.handle === key)?.name ?? (key || "Choose from Vault");
  const submit = (): void => void action.run("ci.settings.set", { enabled: true, vaultKeyRef: key, region, size, maxConcurrent: max, maxJobMinutes: mins, monthlyCapUsd: cap }, "CI runners are on. Linked projects use them for their next run");
  return <FormSheet title="Turn on CI runners" onClose={onClose} submit="Turn on" disabled={key === "" || action.busy} why={key === "" ? "Choose the cloud account first" : undefined} note={action.note} onSubmit={submit} testID="ci-on-sheet">
    <Text style={{ fontSize: 13, color: "var(--ink-3)" as string }}>Jobs from projects linked to a GitHub repo run on throwaway machines in your cloud account. Each machine runs one job and is deleted.</Text>
    <Labeled label="Cloud account" help="The cloud key stays in Vault."><PickButton label="Cloud account" testID="ci-sheet-account" value={keyName} entries={accounts} /></Labeled>
    <Labeled label="Region"><PickButton label="Region" testID="ci-sheet-region" value={titleOf(REGIONS, region)} entries={settingEntries("region", region, 0, (v) => setRegion(v as string))} /></Labeled>
    <Labeled label="Machine size" help="A short job costs about a cent."><PickButton label="Machine size" testID="ci-sheet-size" value={titleOf(SIZES, size)} entries={settingEntries("size", size, 0, (v) => setSize(v as string))} /></Labeled>
    <Labeled label="Most at once"><PickButton label="Most at once" testID="ci-sheet-max" value={String(max)} entries={settingEntries("maxConcurrent", max, 0, (v) => setMax(v as number))} /></Labeled>
    <Labeled label="Time limit per job"><PickButton label="Time limit per job" testID="ci-sheet-mins" value={`${mins} min`} entries={settingEntries("maxJobMinutes", mins, 0, (v) => setMins(v as number))} /></Labeled>
    <Labeled label="Monthly cap" help="CI pauses when the month's cost reaches the cap, and admins get a notice."><PickButton label="Monthly cap" testID="ci-sheet-cap" value={dollars(cap)} entries={settingEntries("monthlyCapUsd", cap, 0, (v) => setCap(v as number))} /></Labeled>
  </FormSheet>;
}

/** One run: what it was, when, what it cost and why it stopped, with a way to the job on GitHub. */
function RunSheet({ runId, now, onClose }: { runId: string; now: number; onClose: () => void }): ReactElement {
  const q = useRead<{ run: CiRun }>("ci.runs.get", { runId });
  const r = q.data?.run;
  const w = r ? runWord(r) : undefined;
  const len = r ? runLength(r, now) : undefined;
  return <Dialog title={r ? `${r.jobName}` : "Run"} onClose={onClose} width={520} testID="ci-run-sheet" actions={[...(r ? [{ label: "View on GitHub", onPress: () => open(runUrl(r)), testID: "ci-run-github" }] : []), { label: "Close", primary: true, onPress: onClose, testID: "ci-run-close" }]}>
    {!r || !w ? <ReadState error={q.error} retry={q.refresh} /> : <Group>
      <Row id="ci-run-what" title={r.repo} note={`Job ${r.jobName}`} trailing={<Stat id="ci-run-sheet-state" word={w.word} tone={w.tone} />} />
      <Row id="ci-run-machine" title={r.size ? `${titleOf(SIZES, r.size)} machine` : "No machine"} note={[ago(now, r.queuedAt), len === undefined ? undefined : durationWord(len)].filter(Boolean).join(" · ")} trailing={<Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>{dollars(r.costUsd)}</Text>} />
      {r.note ? <Row id="ci-run-note" title="What happened" note={r.note} /> : null}
    </Group>}
  </Dialog>;
}

/** What the sweeper deleted: a machine that ran too long, or had no job. */
function CleanupSheet({ runs, now, onClose }: { runs: readonly CiRun[]; now: number; onClose: () => void }): ReactElement {
  return <Dialog title="Cleanup log" onClose={onClose} width={520} testID="ci-log-sheet" actions={[{ label: "Close", primary: true, onPress: onClose, testID: "ci-log-close" }]}>
    <Text style={{ fontSize: 13, color: "var(--ink-3)" as string, marginBottom: 10 }}>Every couple of minutes the cleanup looks for machines in the cloud account and deletes any that outlived their job. It also stops the cost from running on.</Text>
    <Group>
      {runs.length === 0 ? <Row id="ci-log-none" title="Nothing has needed cleaning up" note="Machines are deleted when their job ends." /> : null}
      {runs.map((r) => <Row key={r.runId} id={`ci-log-${r.runId}`} title={r.note ?? "Removed a machine"} note={`${r.repo} · ${r.jobName}`} leading={<Lead><Glyph name="clock" size={15} color="var(--ink-3)" /></Lead>} trailing={<Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>{ago(now, r.endedAt ?? r.queuedAt)}</Text>} />)}
    </Group>
  </Dialog>;
}
