// The model menu (prototype vyre-chat): the one place to pick how a chat runs, opened from the composer. The mode tab (Auto, Ask first, Plan), then Provider and Model (each a submenu that opens to the right of
// its row), Effort, Runs on, More, the limits as quiet meters, and Compact with what to keep. It stays open while you pick (only an outside click or Escape closes it) and everything follows the provider: its
// models, its effort levels, the words on its limits. Only accounts you connected are listed, by the name you gave them. A meter the engine has no number for is left out, never guessed.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MODES, effortForKey, effortsFor, kTokens, limitWords, modeInfo } from "./brain.ts";
import type { ChatMode, ComposerAgent, Effort } from "./brain.ts";
import { BrandMark, I, ensureComposerCss, webOnly } from "./parts.tsx";
import { Glyph } from "./shared.tsx";
import { Row } from "../Row/index.tsx";

export interface PanelAccount {
  ref: string;
  /** The name the person gave it ("Personal", "MLA work"); the provider's name when none was given. */
  name: string;
  provider: string;
  /** "Max", "Team", "Plus", "API key". */
  plan?: string;
  /** This account's session use, 0 to 1, when known. */
  session?: number | null;
}

export interface PanelModel { id: string; title: string; note?: string; window?: number; allowed?: boolean; reason?: string }

export interface UsageMeter { pct: number; resetsAt?: string | number | null }
export interface PanelUsage {
  context: { used: number; window: number } | null;
  session: UsageMeter | null;
  week: UsageMeter | null;
}

export type PanelScope = "chat" | "agent";

/** One place a chat can run. */
export interface RunsOption { key: string; name: string; note?: string; online: boolean; reason?: string }

/** Where a chat runs, from engine.placement.options. `fixed` says why there is no choice (chats with other people always run on the Space). */
export interface PanelRuns {
  value: string;
  current: string | null;
  options: readonly RunsOption[];
  fixed?: { name: string; note: string; line: string };
  onPick(key: string): void;
}

export interface ModelPanelProps {
  agent: ComposerAgent;
  scope: PanelScope;
  onScope(scope: PanelScope): void;
  /** Connected accounts; null while they load. */
  accounts: readonly PanelAccount[] | null;
  accountRef: string | null;
  onAccount(ref: string): void;
  /** The selected account's models (with Auto first when the engine offers it); null while they load. */
  models: readonly PanelModel[] | null;
  model: string | null;
  onModel(id: string): void;
  effort: Effort | undefined;
  onEffort(e: Effort): void;
  /** A quiet word beside Effort ("This chat only" when the choice is the agent's default but effort is not). */
  effortNote?: string;
  /** Usage for the selected account and model; null when the engine reports none, "loading" while it is asked. */
  usage: PanelUsage | null | "loading";
  mode?: ChatMode;
  onMode?(m: ChatMode): void;
  fallback?: boolean;
  onFallback?(on: boolean): void;
  onAddProvider?(): void;
  onClose(): void;
  narrow?: boolean;
  /** Now, for reset times ("21:40" today, "Mon" later). Tests pass a fixed one. */
  now?: number;
  /** The Runs on row; left out where a chat has nowhere to choose. */
  runs?: PanelRuns;
  /** The menu opens under the composer (the first screen, where the composer sits high): submenus hang from their top. */
  below?: boolean;
  /** Compact the context, with what to keep and whether to keep it every time. */
  onCompact?(keep: string, always: boolean): void;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** "21:40" when it resets within a day, else the weekday ("Mon"). Empty when unknown. */
export function resetLabel(at: string | number | null | undefined, now = Date.now()): string {
  if (at === null || at === undefined || at === "") return "";
  const t = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(t)) return typeof at === "string" ? at : "";
  const d = new Date(t);
  if (t - now < 24 * 3600 * 1000) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] ?? "";
}

/** The other account to suggest when this one runs low (session past 80 percent): the least used of the rest, known numbers first. Null when there is none or no need. */
export function lowSuggestion(accounts: readonly PanelAccount[], current: string | null, session: number | null | undefined): PanelAccount | null {
  if (session === null || session === undefined || session <= 0.8) return null;
  const rest = accounts.filter((a) => a.ref !== current);
  if (rest.length === 0) return null;
  const known = rest.filter((a) => typeof a.session === "number").sort((a, b) => (a.session as number) - (b.session as number));
  const best = known[0];
  if (best && (best.session as number) < 0.8) return best;
  return known.length === 0 ? (rest[0] ?? null) : null;
}

/** The context meter follows the model: its window when the model says, the used tokens from the engine. */
export function contextFor(usage: PanelUsage | null, model: PanelModel | undefined): { used: number; window: number } | null {
  if (!usage?.context) return null;
  return { used: usage.context.used, window: model?.window ?? usage.context.window };
}

const providerTitle = (p: string): string => ({ anthropic: "Claude", claude: "Claude", claude_code: "Claude", openai: "ChatGPT", codex: "ChatGPT", grok: "Grok", xai: "Grok", google: "Gemini", openrouter: "OpenRouter", local: "Local", opencode_go: "OpenCode" } as Record<string, string>)[p] ?? p;

function Mini({ v, testID }: { v: number | null | undefined; testID?: string }): ReactElement | null {
  if (typeof v !== "number") return null;
  return (
    <View style={st.mini} testID={testID}>
      <View style={st.miniBar}><View style={[st.miniFill, { width: `${Math.round(Math.min(1, v) * 100)}%` }, v > 0.8 && st.warnFill]} /></View>
      <Text style={st.miniText}>{pct(v)}</Text>
    </View>
  );
}

function Meter({ label, value, frac, testID }: { label: string; value: string; frac: number; testID: string }): ReactElement {
  return (
    <View style={st.lim} testID={testID}>
      <View style={st.limHead}><Text style={st.limLabel}>{label}</Text><Text style={st.limValue}>{value}</Text></View>
      <View style={st.meterBar}><View style={[st.meterFill, { width: `${Math.round(Math.min(1, frac) * 100)}%` }, frac > 0.8 && st.warnFill]} /></View>
    </View>
  );
}

function Seg<T extends string>({ items, on, pick, testID, tight }: { items: readonly { id: T; label: string }[]; on: T | undefined; pick: (id: T) => void; testID: string; tight?: boolean }): ReactElement {
  return (
    <View style={tight ? st.eseg : st.seg} testID={testID} accessibilityRole="radiogroup">
      {/* ui-rows-lint: not a list (segmented control choices) */}
      {items.map((x) => (
        <Pressable key={x.id} accessibilityRole="radio" accessibilityState={{ checked: x.id === on }} accessibilityLabel={x.label} testID={`${testID}-${x.id}`} onPress={() => pick(x.id)} style={[tight ? st.esegBtn : st.segBtn, x.id === on && st.segOn]}>
          <Text style={[tight ? st.esegText : st.segText, x.id === on && st.segTextOn]}>{tight && x.label === "Medium" ? "Med" : x.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Nav({ label, value, on, onPress, testID, lead }: { label: string; value: string; on: boolean; onPress: () => void; testID: string; lead?: ReactNode }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}${value ? `: ${value}` : ""}`} accessibilityState={{ expanded: on }} testID={testID} onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [st.item, on ? st.sel : hovered === true ? st.hover : null]}>
      <Text numberOfLines={1} style={st.itemText}>{label}</Text>
      <View style={st.itemRight}>
        {lead}
        <Text numberOfLines={1} style={st.itemValue}>{value}</Text>
        <Glyph icon={I.chevr} native="›" size={11} color="var(--ink-4)" />
      </View>
    </Pressable>
  );
}

const CHECK = <Glyph icon={I.check} native="✓" size={13} color="var(--accent)" />;

type Sub = "provider" | "model" | "runs" | "more" | "compact";

export function ModelPanel(p: ModelPanelProps): ReactElement {
  ensureComposerCss();
  const [sub, setSub] = useState<Sub | null>(null);
  const [flip, setFlip] = useState(false);
  const [keep, setKeep] = useState("");
  const [always, setAlways] = useState(false);
  const node = useRef<{ focus?: () => void; getBoundingClientRect?: () => { right: number } } | null>(null);
  useEffect(() => { node.current?.focus?.(); }, []);
  const toggle = (next: Sub): void => {
    const box = node.current?.getBoundingClientRect?.();
    const room = (globalThis as { innerWidth?: number }).innerWidth;
    setFlip(box !== undefined && room !== undefined && box.right + 228 > room);
    setSub((cur) => (cur === next ? null : next));
  };
  const accounts = p.accounts ?? [];
  const account = accounts.find((a) => a.ref === p.accountRef) ?? null;
  const model = (p.models ?? []).find((m) => m.id === p.model);
  const usage = p.usage === "loading" ? null : p.usage;
  const ctx = contextFor(usage, model);
  const session = usage?.session ?? null;
  const week = usage?.week ?? null;
  const better = lowSuggestion(accounts, p.accountRef, session?.pct ?? account?.session);
  const agentName = p.agent.name;
  const efforts = effortsFor(account?.provider ?? p.agent.provider);
  const words = limitWords(account?.provider ?? p.agent.provider);
  const scopeLabel = p.scope === "chat" ? "This chat" : `Default for ${agentName.split(/[\s’']/)[0] ?? agentName}`;
  const noMeters = !ctx && !session && !week;

  const onKeyDown = (e: { key: string; shiftKey?: boolean; preventDefault(): void; stopPropagation?(): void; target?: { tagName?: string } }): void => {
    if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") { if (e.key === "Escape") { e.preventDefault(); setSub(null); } return; }
    const eff = effortForKey(e.key, efforts);
    if (eff) { e.preventDefault(); p.onEffort(eff); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation?.(); if (sub) setSub(null); else p.onClose(); return; }
    if (e.key === "Tab" && e.shiftKey === true && p.onMode && p.mode) { e.preventDefault(); const i = MODES.findIndex((m) => m.id === p.mode); p.onMode((MODES[(i + 1) % MODES.length] as { id: ChatMode }).id); }
  };

  const subBody = (): ReactElement | null => {
    if (sub === "provider") return (
      <View testID="model-accounts">
        <Text style={st.grp}>Provider</Text>
        {accounts.map((a) => (
          <Row key={a.ref} id={`model-account-${a.ref}`} title={a.name} note={`${providerTitle(a.provider)}${a.plan ? ` ${a.plan}` : ""}`} selected={a.ref === p.accountRef}
            leading={<View style={st.brand}><BrandMark provider={a.provider} size={15} /></View>} trailing={<Mini v={a.session} testID={`model-account-${a.ref}-mini`} />}
            onPress={() => { p.onAccount(a.ref); setSub("model"); }} />
        ))}
        {p.onAddProvider ? (
          <>
            <View style={st.dv} />
            <Pressable accessibilityRole="button" accessibilityLabel="Connect another" testID="model-add-provider" onPress={() => { setSub(null); p.onAddProvider?.(); }} style={({ hovered }: { hovered?: boolean }) => [st.item, hovered === true && st.hover]}>
              <Text style={st.itemText}>Connect another</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    );
    if (sub === "model") return (
      <View testID="model-models">
        <Text style={st.grp}>{account?.name ?? "Model"}</Text>
        {p.models === null ? <Text style={st.quiet}>Reading models</Text> : p.models.length === 0 ? <Text style={st.quiet}>This account lists no models.</Text> : null}
        {(p.models ?? []).map((m) => {
          const on = m.id === p.model;
          const off = m.allowed === false;
          // a model the account may not use stays visible with the reason, and does nothing when pressed
          return <Row key={m.id} id={`model-${m.id}`} title={m.title} selected={on} {...(off ? { note: m.reason ?? "Not available on this account" } : m.note ? { note: m.note } : {})} trailing={on ? CHECK : null} {...(off ? {} : { onPress: () => { p.onModel(m.id); setSub(null); } })} />;
        })}
      </View>
    );
    if (sub === "runs" && p.runs) {
      const r = p.runs;
      return (
        <View testID="model-runs">
          <Text style={st.grp}>Runs on</Text>
          {r.fixed ? (
            <>
              <View style={st.item}><Text style={st.itemText}>{r.fixed.name}</Text><Text style={st.itemValue}>{r.fixed.note}</Text></View>
              <Text style={st.cap}>{r.fixed.line}</Text>
            </>
          ) : (
            <>
              {r.options.map((o) => <Row key={o.key} id={`model-runs-${o.key}`} title={o.name} {...(o.note ? { note: o.note } : !o.online && o.reason ? { note: o.reason } : {})} selected={o.key === r.current} trailing={o.key === r.current ? CHECK : null} {...(o.online ? { onPress: () => { r.onPick(o.key); setSub(null); } } : {})} />)}
              <Text style={st.cap}>Same chat wherever it runs. Only this Space's computers are listed.</Text>
            </>
          )}
        </View>
      );
    }
    if (sub === "more") return (
      <View testID="model-more">
        <Text style={st.grp}>Applies to</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Applies to: ${scopeLabel}`} testID="model-scope" onPress={() => p.onScope(p.scope === "chat" ? "agent" : "chat")} style={({ hovered }: { hovered?: boolean }) => [st.item, hovered === true && st.hover]}>
          <Text numberOfLines={1} style={st.itemText}>{scopeLabel}</Text>
        </Pressable>
        {p.onFallback ? (
          <>
            <Text style={st.grp}>If a limit hits</Text>
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: p.fallback === true }} aria-checked={p.fallback === true} accessibilityLabel="Switch when limits run out" testID="model-fallback" onPress={() => p.onFallback?.(!(p.fallback === true))} style={st.tog}>
              <View style={st.togText}><Text style={st.itemText}>Switch accounts</Text><Text style={st.limLabel}>Moves to your next account, then back</Text></View>
              <View style={[st.sw, p.fallback === true && st.swOn]}><View style={[st.knob, p.fallback === true && st.knobOn]} /></View>
            </Pressable>
          </>
        ) : null}
      </View>
    );
    if (sub === "compact") return (
      <View testID="model-compact-form" style={st.form}>
        <TextInput accessibilityLabel="What should it keep?" testID="model-compact-keep" value={keep} onChangeText={setKeep} placeholder="What should it keep? Optional" placeholderTextColor="var(--ink-3)" style={st.field} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: always }} aria-checked={always} testID="model-compact-always" onPress={() => setAlways((x) => !x)} style={st.check}>
          <View style={[st.box, always && st.boxOn]}>{always ? <Glyph icon={I.check} native="✓" size={11} color="var(--accent-ink)" /> : null}</View>
          <Text style={st.limLabel}>Keep this every time</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Compact" testID="model-compact-go" onPress={() => { p.onCompact?.(keep.trim(), always); p.onClose(); }} style={st.go}><Text style={st.goText}>Compact</Text></Pressable>
      </View>
    );
    return null;
  };
  const body = subBody();

  return (
    <View
      testID="model-panel"
      accessibilityLabel={`${agentName}: mode, model, effort and limits`}
      style={[st.panel, p.narrow && st.panelNarrow]}
      ref={node as never}
      {...webOnly({ tabIndex: -1, onKeyDown, role: "dialog" })}
    >
      {p.onMode && p.mode ? (
        <>
          <Seg items={MODES.map((m) => ({ id: m.id, label: m.label }))} on={p.mode} pick={(m) => p.onMode?.(m)} testID="model-mode" />
          <Text style={st.modeNote} testID="model-mode-note">{modeInfo(p.mode).note}</Text>
        </>
      ) : null}
      {p.accounts !== null && accounts.length === 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Connect an AI account" testID="model-account" onPress={() => p.onAddProvider?.()} style={({ hovered }: { hovered?: boolean }) => [st.item, hovered === true && st.hover]}>
          <Text style={st.itemText}>Connect an AI account</Text>
        </Pressable>
      ) : (
        <Nav label="Provider" value={account?.name ?? (p.accounts === null ? "" : "Choose")} on={sub === "provider"} onPress={() => toggle("provider")} testID="model-account" lead={account ? <BrandMark provider={account.provider} size={13} /> : undefined} />
      )}
      <Nav label="Model" value={model?.title ?? p.agent.modelTitle ?? "Auto"} on={sub === "model"} onPress={() => toggle("model")} testID="model-model" />
      <View style={st.item}>
        <Text style={st.itemText}>Effort</Text>
        <View style={st.itemRight}><Seg tight items={efforts} on={efforts.some((e) => e.id === p.effort) ? p.effort : "medium"} pick={(e) => p.onEffort(e)} testID="model-effort" /></View>
      </View>
      {p.runs ? <Nav label="Runs on" value={p.runs.fixed?.name ?? p.runs.value} on={sub === "runs"} onPress={() => toggle("runs")} testID="model-runs-row" /> : null}
      <Nav label="More" value="" on={sub === "more"} onPress={() => toggle("more")} testID="model-more-row" />
      {noMeters && p.usage !== "loading" ? null : (
        <>
          <View style={st.dv} />
          <View style={st.lims} testID="model-usage">
            {session ? <Meter testID="meter-session" label={words.session} frac={session.pct} value={resetLabel(session.resetsAt, p.now) ? `resets ${resetLabel(session.resetsAt, p.now)}` : pct(session.pct)} /> : null}
            {week ? <Meter testID="meter-week" label={words.week} frac={week.pct} value={resetLabel(week.resetsAt, p.now) ? `resets ${resetLabel(week.resetsAt, p.now)}` : pct(week.pct)} /> : null}
            {ctx ? <Meter testID="meter-context" label="Context" frac={ctx.used / ctx.window} value={`${kTokens(ctx.used)} / ${kTokens(ctx.window)}`} /> : null}
          </View>
        </>
      )}
      {better && account ? (
        <View style={st.low} testID="model-low" {...webOnly({ dataSet: { cmpLow: "1" } })}>
          <Text style={st.lowText}>{`Running low on ${account.name}.`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Use ${better.name}`} testID="model-low-switch" onPress={() => p.onAccount(better.ref)}>
            <Text style={st.lowBtn}>{`Use ${better.name}${typeof better.session === "number" ? ` · ${pct(better.session)}` : ""}`}</Text>
          </Pressable>
        </View>
      ) : null}
      {p.onCompact ? (
        <>
          <View style={st.dv} />
          <Nav label="Compact" value="Free up context" on={sub === "compact"} onPress={() => toggle("compact")} testID="model-compact" />
        </>
      ) : null}
      {body ? <View testID="model-sub" style={p.narrow ? st.subInline : [st.sub, flip ? st.subLeft : st.subRight, p.below ? st.subTop : null]} {...webOnly({ dataSet: { cmpPop: "1" } })}>{body}</View> : null}
    </View>
  );
}

const st = StyleSheet.create({
  panel: { width: 286, padding: 6, backgroundColor: "var(--raised)" as string, borderRadius: 16, outlineStyle: "none" } as object,
  panelNarrow: { width: "100%" },
  seg: { flexDirection: "row", marginHorizontal: 4, marginTop: 4, padding: 2, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  segBtn: { flex: 1, height: 27, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  segOn: { backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1)" } as object,
  segText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  modeNote: { fontSize: 11.5, lineHeight: 15, color: "var(--ink-3)" as string, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 6 },
  item: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 32, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10 },
  itemText: { fontSize: 13, color: "var(--ink)" as string },
  itemRight: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  itemValue: { flexShrink: 1, fontSize: 12, color: "var(--ink-3)" as string },
  hover: { backgroundColor: "var(--hover)" as string },
  sel: { backgroundColor: "var(--sel)" as string },
  eseg: { flexDirection: "row", padding: 2, borderRadius: 7, backgroundColor: "var(--sunk)" as string },
  esegBtn: { height: 22, paddingHorizontal: 7, alignItems: "center", justifyContent: "center", borderRadius: 5 },
  esegText: { fontSize: 11.5, color: "var(--ink-3)" as string },
  dv: { height: 1, backgroundColor: "var(--line)" as string, marginVertical: 5, marginHorizontal: 9 },
  lims: { paddingHorizontal: 9, paddingTop: 6, paddingBottom: 8, gap: 9 },
  lim: { gap: 4 },
  limHead: { flexDirection: "row", justifyContent: "space-between" },
  limLabel: { fontSize: 11.5, color: "var(--ink-2)" as string },
  limValue: { fontSize: 11.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] } as object,
  meterBar: { height: 3, borderRadius: 3, backgroundColor: "var(--sel)" as string, overflow: "hidden" },
  meterFill: { height: "100%", backgroundColor: "var(--accent)" as string },
  warnFill: { backgroundColor: "var(--warn)" as string },
  mini: { flexDirection: "row", alignItems: "center", gap: 6 },
  miniBar: { width: 34, height: 4, borderRadius: 3, backgroundColor: "var(--line-2)" as string, overflow: "hidden" },
  miniFill: { height: "100%", backgroundColor: "var(--accent)" as string },
  miniText: { fontSize: 11, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] } as object,
  sub: { position: "absolute", bottom: 0, width: 216, padding: 6, zIndex: 3, backgroundColor: "var(--raised)" as string, borderRadius: 14, boxShadow: "var(--sh-pop)" } as object,
  subRight: { left: "100%", marginLeft: 6 },
  subTop: { bottom: "auto" as unknown as number, top: 0 },
  subLeft: { right: "100%", marginRight: 6 },
  subInline: { marginTop: 4, padding: 4, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  grp: { fontSize: 11.5, color: "var(--ink-4)" as string, paddingTop: 9, paddingBottom: 4, paddingHorizontal: 9 },
  brand: { width: 18, marginRight: 6, alignItems: "center" },
  cap: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string, paddingHorizontal: 9, paddingTop: 2, paddingBottom: 8 },
  quiet: { fontSize: 12, color: "var(--ink-3)" as string, paddingVertical: 4, paddingHorizontal: 9 },
  low: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, marginHorizontal: 4, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  lowText: { flex: 1, fontSize: 12, color: "var(--ink-2)" as string },
  lowBtn: { fontSize: 12, fontWeight: "600", color: "var(--ink)" as string },
  tog: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 9, paddingVertical: 6 },
  togText: { flex: 1, gap: 2 },
  sw: { width: 30, height: 18, borderRadius: 999, backgroundColor: "var(--line-2)" as string, justifyContent: "center", paddingHorizontal: 2 },
  swOn: { backgroundColor: "var(--accent)" as string },
  knob: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#fff" },
  knobOn: { transform: [{ translateX: 12 }] },
  form: { gap: 8, padding: 4 },
  field: { height: 34, borderRadius: 9, paddingHorizontal: 11, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string, outlineStyle: "none" } as object,
  check: { flexDirection: "row", alignItems: "center", gap: 7 },
  box: { width: 15, height: 15, borderRadius: 4, alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1.4px var(--line-2)" } as object,
  boxOn: { backgroundColor: "var(--accent)" as string, boxShadow: "none" } as object,
  go: { height: 30, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  goText: { fontSize: 13, fontWeight: "600", color: "var(--accent-ink)" as string },
});
