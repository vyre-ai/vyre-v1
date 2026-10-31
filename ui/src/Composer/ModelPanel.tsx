// The model panel (rc.8 composer): opened from the agent strip. Who answers, which of your accounts pays, the model, effort, what is used of the context and the account's limits,
// the chat's mode, and whether to switch accounts when limits run out. It stays open while you pick (only an outside click or Escape closes it) and every number follows the account
// and model picked. Only accounts you connected are listed, by the name you gave them. A meter the engine has no number for is left out, never guessed.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar, avatarOf } from "../Avatar/index.tsx";
import { EFFORTS, MODES, effortForKey, kTokens, modeInfo } from "./brain.ts";
import type { ChatMode, ComposerAgent, Effort } from "./brain.ts";
import { BrandMark, I, webOnly } from "./parts.tsx";
import { Glyph } from "./shared.tsx";

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

function Meter({ label, value, sub, frac, testID }: { label: string; value: ReactElement | string; sub?: string; frac: number; testID: string }): ReactElement {
  return (
    <View style={st.meter} testID={testID}>
      <Text style={st.meterLabel}>{label}</Text>
      {typeof value === "string" ? <Text style={st.meterValue}>{value}</Text> : value}
      <View style={st.meterBar}><View style={[st.meterFill, { width: `${Math.round(Math.min(1, frac) * 100)}%` }, frac > 0.8 && st.warnFill]} /></View>
      {sub ? <Text style={st.meterLabel}>{sub}</Text> : null}
    </View>
  );
}

function Seg<T extends string>({ items, on, pick, testID }: { items: readonly { id: T; label: string; note?: string }[]; on: T | undefined; pick: (id: T) => void; testID: string }): ReactElement {
  return (
    <View style={st.seg} testID={testID} accessibilityRole="radiogroup">
      {items.map((x) => (
        <Pressable key={x.id} accessibilityRole="radio" accessibilityState={{ checked: x.id === on }} accessibilityLabel={x.label} testID={`${testID}-${x.id}`} onPress={() => pick(x.id)} style={[st.segBtn, x.id === on && st.segOn]}>
          <Text style={[st.segText, x.id === on && st.segTextOn]}>{x.label}</Text>
          {x.note ? <Text style={st.segNote}>{x.note}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function AccountRow({ a, on, onPress, testID, chevron }: { a: PanelAccount; on: boolean; onPress: () => void; testID: string; chevron?: boolean }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${a.name}, ${providerTitle(a.provider)}${a.plan ? ` ${a.plan}` : ""}`} accessibilityState={{ selected: on }} testID={testID} onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [chevron ? st.acctRow : st.acct, on && !chevron && st.sel, hovered === true && !on && st.hover]}>
      <BrandMark provider={a.provider} size={15} />
      <View style={st.acctText}>
        <Text numberOfLines={1} style={st.acctName}>{a.name}</Text>
        <Text numberOfLines={1} style={st.acctPlan}>{`${providerTitle(a.provider)}${a.plan ? ` ${a.plan}` : ""}`}</Text>
      </View>
      <Mini v={a.session} testID={`${testID}-mini`} />
      {chevron ? <Glyph icon={I.chevr} native="›" size={12} color="var(--ink-3)" /> : null}
    </Pressable>
  );
}

export function ModelPanel(p: ModelPanelProps): ReactElement {
  const [fly, setFly] = useState(false);
  const node = useRef<{ focus?: () => void } | null>(null);
  useEffect(() => { node.current?.focus?.(); }, []);
  const accounts = p.accounts ?? [];
  const account = accounts.find((a) => a.ref === p.accountRef) ?? null;
  const model = (p.models ?? []).find((m) => m.id === p.model);
  const usage = p.usage === "loading" ? null : p.usage;
  const ctx = contextFor(usage, model);
  const session = usage?.session ?? null;
  const week = usage?.week ?? null;
  const better = lowSuggestion(accounts, p.accountRef, session?.pct ?? account?.session);
  const agentName = p.agent.name;
  const scopeLabel = p.scope === "chat" ? "This chat" : `Default for ${agentName.split(/[\s’']/)[0] ?? agentName}`;

  const onKeyDown = (e: { key: string; shiftKey?: boolean; preventDefault(): void; stopPropagation?(): void; target?: { tagName?: string } }): void => {
    const eff = effortForKey(e.key);
    if (eff) { e.preventDefault(); p.onEffort(eff); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation?.(); if (fly) setFly(false); else p.onClose(); return; }
    if (e.key === "Tab" && e.shiftKey === true && p.onMode && p.mode) { e.preventDefault(); const i = MODES.findIndex((m) => m.id === p.mode); p.onMode((MODES[(i + 1) % MODES.length] as { id: ChatMode }).id); }
  };

  const flyList = (
    <View style={p.narrow ? st.flyInline : st.fly} testID="model-accounts">
      <Text style={st.grp}>Your accounts</Text>
      {accounts.map((a) => <AccountRow key={a.ref} a={a} on={a.ref === p.accountRef} testID={`model-account-${a.ref}`} onPress={() => { p.onAccount(a.ref); setFly(false); }} />)}
      {p.onAddProvider ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Add another AI provider" testID="model-add-provider" onPress={() => { setFly(false); p.onAddProvider?.(); }} style={({ hovered }: { hovered?: boolean }) => [st.add, hovered === true && st.hover]}>
          <Glyph icon={I.plus} native="+" size={15} color="var(--ink-3)" />
          <Text style={st.addText}>Add another AI provider</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View
      testID="model-panel"
      accessibilityLabel={`${agentName}: model, effort and limits`}
      style={[st.panel, p.narrow && st.panelNarrow]}
      ref={node as never}
      {...webOnly({ tabIndex: -1, onKeyDown, role: "dialog" })}
    >
      <View style={st.head}>
        <Avatar {...avatarOf({ id: p.agent.id, name: agentName, kind: p.agent.kind === "assistant" ? "assistant" : "agent" })} size={22} />
        <Text numberOfLines={1} style={st.headName}>{agentName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Applies to: ${scopeLabel}`} testID="model-scope" onPress={() => p.onScope(p.scope === "chat" ? "agent" : "chat")} style={({ hovered }: { hovered?: boolean }) => [st.scope, hovered === true && st.hover]}>
          <Text style={st.scopeText}>{scopeLabel}</Text>
          <Glyph icon={I.chev} native="▾" size={11} color="var(--ink-3)" />
        </Pressable>
      </View>

      <View style={st.sec}>
        <View style={st.h5}><Text style={st.h5Text}>Account</Text>{p.accounts ? <Text style={st.h5Note}>{`${accounts.length} connected`}</Text> : null}</View>
        {p.accounts === null ? <Text style={st.quiet}>Loading your accounts</Text>
          : account ? <AccountRow a={{ ...account, session: session?.pct ?? account.session ?? null }} on={fly} chevron testID="model-account" onPress={() => setFly((f) => !f)} />
          : (
            <Pressable accessibilityRole="button" accessibilityLabel="Choose an account" testID="model-account" onPress={() => (accounts.length > 0 ? setFly((f) => !f) : p.onAddProvider?.())} style={st.acctRow}>
              <Text style={st.acctName}>{accounts.length > 0 ? "Choose an account" : "Connect an AI account"}</Text>
            </Pressable>
          )}
        {fly && p.narrow ? flyList : null}
        <View style={st.models} testID="model-models">
          {p.models === null ? <Text style={st.quiet}>Loading models</Text> : (p.models.length === 0 ? <Text style={st.quiet}>This account lists no models.</Text> : null)}
          {(p.models ?? []).map((m) => {
            const on = m.id === p.model;
            const off = m.allowed === false;
            return (
              <Pressable key={m.id} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: off }} accessibilityLabel={m.title} testID={`model-${m.id}`} disabled={off} onPress={() => p.onModel(m.id)}
                {...webOnly(off && m.reason ? { title: m.reason } : {})}
                style={({ hovered }: { hovered?: boolean }) => [st.model, on && st.sel, hovered === true && !on && st.hover, off && st.off]}>
                <View style={st.ck}>{on ? <Glyph icon={I.check} native="✓" size={14} color="var(--accent)" /> : null}</View>
                <Text numberOfLines={1} style={st.modelTitle}>{m.title}</Text>
                {m.note ? <Text numberOfLines={1} style={st.modelNote}>{m.note}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={st.sec}>
        <View style={st.h5}><Text style={st.h5Text}>Effort</Text><Text style={st.h5Note}>1 to 4</Text></View>
        <Seg items={EFFORTS} on={p.effort ?? "medium"} pick={(e) => p.onEffort(e)} testID="model-effort" />
      </View>

      <View style={st.sec} testID="model-usage">
        <View style={st.h5}><Text style={st.h5Text}>{account ? `${account.name} usage` : "Usage"}</Text>{model ? <Text style={st.h5Note}>{model.title}</Text> : null}</View>
        {p.usage === "loading" ? <Text style={st.quiet}>Reading usage</Text> : null}
        {p.usage !== "loading" && !ctx && !session && !week ? <Text style={st.quiet} testID="model-usage-none">No usage reported for this account yet</Text> : null}
        <View style={st.meters}>
          {ctx ? <Meter testID="meter-context" label="Context" frac={ctx.used / ctx.window} value={<Text style={st.meterValue}>{kTokens(ctx.used)}<Text style={st.meterOf}>{` / ${kTokens(ctx.window)}`}</Text></Text>} /> : null}
          {session ? <Meter testID="meter-session" label="Session" frac={session.pct} value={pct(session.pct)} {...(resetLabel(session.resetsAt, p.now) ? { sub: `resets ${resetLabel(session.resetsAt, p.now)}` } : {})} /> : null}
          {week ? <Meter testID="meter-week" label="Week" frac={week.pct} value={pct(week.pct)} {...(resetLabel(week.resetsAt, p.now) ? { sub: `resets ${resetLabel(week.resetsAt, p.now)}` } : {})} /> : null}
        </View>
        {better && account ? (
          <View style={st.low} testID="model-low">
            <Text style={st.lowText}>{`Running low on ${account.name}.`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Use ${better.name}`} testID="model-low-switch" onPress={() => p.onAccount(better.ref)}>
              <Text style={st.lowBtn}>{`Use ${better.name}${typeof better.session === "number" ? ` · ${pct(better.session)}` : ""}`}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {p.onMode && p.mode ? (
        <View style={st.sec}>
          <View style={st.h5}><Text style={st.h5Text}>Mode</Text></View>
          <Seg items={MODES} on={p.mode} pick={(m) => p.onMode?.(m)} testID="model-mode" />
          <Text style={st.modeNote} testID="model-mode-note">{modeInfo(p.mode).note}</Text>
        </View>
      ) : null}

      {p.onFallback ? (
        <View style={[st.sec, st.last]}>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: p.fallback === true }} aria-checked={p.fallback === true} accessibilityLabel="Switch when limits run out" testID="model-fallback" onPress={() => p.onFallback?.(!(p.fallback === true))} style={st.tog}>
            <View style={st.togText}>
              <Text style={st.togTitle}>Switch when limits run out</Text>
              <Text style={st.togSub}>Moves to your next account, then back</Text>
            </View>
            <View style={[st.sw, p.fallback === true && st.swOn]}><View style={[st.knob, p.fallback === true && st.knobOn]} /></View>
          </Pressable>
        </View>
      ) : null}
      {fly && !p.narrow ? flyList : null}
      {Platform.OS === "web" && !p.narrow ? <View style={st.foot}><Text style={st.footText}>{"⇧⇥ mode   1-4 effort   esc close"}</Text></View> : null}
    </View>
  );
}

const st = StyleSheet.create({
  panel: { width: 340, backgroundColor: "var(--raised)" as string, borderRadius: 16, outlineStyle: "none" } as object,
  panelNarrow: { width: "100%" },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  headName: { fontWeight: "600", fontSize: 13, color: "var(--ink)" as string, flexShrink: 1 },
  scope: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  scopeText: { fontSize: 12, color: "var(--ink-3)" as string },
  sec: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  last: { borderBottomWidth: 0 },
  h5: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  h5Text: { fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--ink-4)" as string, fontWeight: "600" },
  h5Note: { fontSize: 11.5, color: "var(--ink-3)" as string, fontWeight: "500" },
  quiet: { fontSize: 12, color: "var(--ink-3)" as string, paddingVertical: 4 },
  acctRow: { flexDirection: "row", alignItems: "center", gap: 8, width: "100%", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  acct: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 9 },
  acctText: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" },
  acctName: { fontWeight: "600", fontSize: 12.5, color: "var(--ink)" as string },
  acctPlan: { fontSize: 11.5, color: "var(--ink-3)" as string },
  mini: { flexDirection: "row", alignItems: "center", gap: 6 },
  miniBar: { width: 34, height: 4, borderRadius: 3, backgroundColor: "var(--line-2)" as string, overflow: "hidden" },
  miniFill: { height: "100%", backgroundColor: "var(--accent)" as string },
  miniText: { fontSize: 11, color: "var(--ink-3)" as string },
  warnFill: { backgroundColor: "var(--warn)" as string },
  fly: { position: "absolute", left: "100%", marginLeft: 6, top: 52, width: 264, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, borderRadius: 14, padding: 6, zIndex: 3, boxShadow: "var(--sh-pop)" } as object,
  flyInline: { marginTop: 6, padding: 4, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string },
  grp: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--ink-4)" as string, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 8 },
  add: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 9 },
  addText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  models: { marginTop: 6, marginHorizontal: -4, gap: 1 },
  model: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, minHeight: 30 },
  ck: { width: 14, alignItems: "center" },
  modelTitle: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  modelNote: { marginLeft: "auto", fontSize: 11.5, color: "var(--ink-3)" as string },
  sel: { backgroundColor: "var(--sel)" as string },
  hover: { backgroundColor: "var(--hover)" as string },
  off: { opacity: 0.45 },
  seg: { flexDirection: "row", gap: 3, padding: 3, borderRadius: 9, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 4, borderRadius: 7 },
  segOn: { backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1)" } as object,
  segText: { fontSize: 12, color: "var(--ink-3)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  segNote: { fontSize: 10, color: "var(--ink-4)" as string },
  meters: { flexDirection: "row", gap: 10 },
  meter: { flex: 1, gap: 4 },
  meterLabel: { fontSize: 11.5, color: "var(--ink-3)" as string },
  meterValue: { fontSize: 13, color: "var(--ink)" as string, fontWeight: "600" },
  meterOf: { fontWeight: "400", color: "var(--ink-3)" as string },
  meterBar: { height: 4, borderRadius: 3, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 3, backgroundColor: "var(--accent)" as string },
  low: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: "color-mix(in srgb, var(--warn) 12%, transparent)" as string },
  lowText: { flex: 1, fontSize: 12, color: "var(--ink-2)" as string },
  lowBtn: { fontSize: 12, fontWeight: "600", color: "var(--ink)" as string },
  modeNote: { fontSize: 11.5, color: "var(--ink-3)" as string, marginTop: 6 },
  tog: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  togText: { flex: 1 },
  togTitle: { fontSize: 12.5, color: "var(--ink)" as string },
  togSub: { fontSize: 11.5, color: "var(--ink-3)" as string },
  sw: { width: 30, height: 18, borderRadius: 999, backgroundColor: "var(--line-2)" as string, justifyContent: "center", paddingHorizontal: 2 },
  swOn: { backgroundColor: "var(--accent)" as string },
  knob: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#fff" },
  knobOn: { transform: [{ translateX: 12 }] },
  foot: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  footText: { fontSize: 11, color: "var(--ink-4)" as string },
});
