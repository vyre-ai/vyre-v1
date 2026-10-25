// Promote to Space (spec 3.7, 2.12; ARCH 7.7): a Personal Automation runs on its owner's own access; a Space Automation runs on access granted to the Automation itself. This sheet is the
// access diff before that change: what it stops using of yours, what it will run on, and, for each AI step on a subscription sign-in (which cannot be shared), the shared API key to use
// instead. Promote stays off until every such step has an API key. Nothing changes until the button is pressed, and the history and versions come with it.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton, pointer } from "../canvas/parts.tsx";
import { Glyph } from "./glyphs.tsx";
import { LEVEL_WORDS, VIA_WORDS, canPromote, choiceFor, initialChoices, plural, promoteInput, setChoice } from "./model.ts";
import type { Automation, Choice, PromoteDiff } from "./model.ts";
import { each } from "../runs/each.ts";
import { Hint } from "./parts.tsx";

export type PreviewState = { phase: "loading" } | { phase: "ready"; preview: PromoteDiff } | { phase: "failed"; message: string };

/** The access diff of promoting one Automation, read once when the sheet (or a Personal Automation's Settings) opens. */
export function usePromotePreview(automationId: string, enabled = true): PreviewState {
  const data = useAutomationsData();
  const [state, setState] = useState<PreviewState>({ phase: "loading" });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    data.call("automations.preview_promote", { automationId }).then((p) => { if (live) setState({ phase: "ready", preview: p as PromoteDiff }); }).catch((e: unknown) => { if (live) setState({ phase: "failed", message: e instanceof Error ? e.message : "That did not load." }); });
    return () => { live = false; };
  }, [data, automationId, enabled]);
  return state;
}

export interface PromoteSheetProps {
  automation: Automation;
  onClose(): void;
  onPromoted?(a: Automation): void;
  /** Start from a preview already read (the Settings tab reads one for its own text). */
  preview?: PromoteDiff;
}

export function PromoteSheet({ automation, onClose, onPromoted, preview: given }: PromoteSheetProps): ReactElement {
  const data = useAutomationsData();
  const read = usePromotePreview(automation.id, given === undefined);
  const state: PreviewState = given ? { phase: "ready", preview: given } : read;
  return (
    <View testID="promote-sheet" accessibilityLabel={`Promote ${automation.name} to the Space`} style={s.card}>
      <View style={s.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={s.title}>{`Promote “${automation.name}” to the Space`}</Text>
          <Text style={s.sub}>This is the access it will run on. Confirm the changes.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} testID="promote-close" style={[s.x, pointer]}><Glyph name="x" size={14} color="var(--ink-3)" /></Pressable>
      </View>
      {state.phase === "loading" ? <View style={s.body}><Text style={s.dim}>Working out what it would run on…</Text></View> : null}
      {state.phase === "failed" ? <View style={s.body}><Text testID="promote-failed" style={s.err}>{state.message}</Text></View> : null}
      {state.phase === "ready" ? <PromoteBody key={automation.id} automation={automation} preview={state.preview} onClose={onClose} {...(onPromoted ? { onPromoted } : {})} call={data.call} keys={data.keys} me={data.me.id} name={data.name} /> : null}
    </View>
  );
}

function PromoteBody({ automation, preview, onClose, onPromoted, call, keys, me, name }: { automation: Automation; preview: PromoteDiff; onClose(): void; onPromoted?: (a: Automation) => void; call(cap: string, input: unknown): Promise<unknown>; keys: readonly { id: string; name: string; kind: "subscription" | "api" }[]; me: string; name(id: string): string }): ReactElement {
  const { element, show } = useMenu();
  const [choices, setChoices] = useState<Choice[]>(() => initialChoices(preview.diff, keys));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = preview.diff;
  const ok = canPromote(preview, choices, keys) && !busy;
  const apiKeys = keys.filter((k) => k.kind === "api");
  const nodeTitle = (stepId: string): string => automation.definition.nodes.find((n) => n.id === stepId)?.title ?? stepId;
  const nodeAgent = (stepId: string): string => { const id = automation.definition.nodes.find((n) => n.id === stepId)?.ai?.agentId; return id ? name(id) : "An agent"; };

  const promote = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try {
      const out = (await call("automations.promote", promoteInput(automation.id, me, choices))) as { automation: Automation };
      onPromoted?.(out.automation);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); setBusy(false); }
  };

  return (
    <>
      <ScrollView style={s.scroll} contentContainerStyle={s.body}>
        <View style={s.line}>
          <View style={s.mark} />
          <View style={{ flex: 1 }}>
            <Text style={s.strong}>It becomes a Service</Text>
            <Text style={s.dim}>{`It runs as “${automation.name}”, not as you, and its access is capped by yours. Agent steps run on a shared API key, never a subscription.`}</Text>
          </View>
        </View>

        <Text accessibilityRole="header" style={s.fl}>Stops running on your access</Text>
        {d.grants.filter((g) => g.via === "owner_access").length === 0 && d.vaultNames.length === 0 && d.keysToReplace.length === 0 ? <Text style={s.dim}>Nothing.</Text> : null}
        {each(d.grants.filter((g) => g.via === "owner_access"), (g) => <DiffRow key={`o-${g.resource}`} sign="-" text={`Your own access to ${g.resource}`} sub={`${LEVEL_WORDS[g.level]}`} />)}
        {each(d.vaultNames, (v) => <DiffRow key={`ov-${v}`} sign="-" text={`Your own ${v} sign-in`} />)}
        {d.keysToReplace.length ? <DiffRow sign="-" text={`Your own AI account for ${plural(d.keysToReplace.length, "agent step")}`} sub="A subscription sign-in stays yours and cannot be shared" /> : null}

        <Text accessibilityRole="header" style={s.fl}>Will run on access given to it</Text>
        {each(d.grants.filter((g) => g.via !== "owner_access"), (g) => <DiffRow key={`n-${g.resource}`} sign="+" text={`${LEVEL_WORDS[g.level]} on ${g.resource}`} sub={VIA_WORDS[g.via]} />)}
        {each(d.vaultNames, (v) => <DiffRow key={`nv-${v}`} sign="+" mono text={v} sub="From the Vault. Shared with the automation. Agents see the handle, never the value." />)}
        {each(d.connections, (c) => <DiffRow key={`c-${c}`} sign="+" text={`The ${c} connection`} sub="Used by the Automation only" />)}
        {each(d.keysToReplace, (k) => {
          const chosen = choiceFor(choices, k.stepId);
          const label = keys.find((x) => x.id === chosen)?.name ?? "Choose a key";
          return (
            <View key={k.stepId} testID={`replace-${k.stepId}`} style={s.keyRow}>
              <Text style={[s.sign, { color: "var(--ok)" as string }]}>+</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={s.strong2}>{nodeTitle(k.stepId)}</Text>
                <Text numberOfLines={2} style={s.dim}>{`${nodeAgent(k.stepId)}. ${k.reason}`}</Text>
              </View>
              <Pressable
                accessibilityRole="button" accessibilityLabel={`Key for ${nodeTitle(k.stepId)}, ${label}`} testID={`replace-pick-${k.stepId}`}
                onPress={(e) => { const n = (e as { nativeEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number } }).nativeEvent ?? {}; show(apiKeys.length ? each(apiKeys, (x) => ({ label: x.name, checked: x.id === chosen, onSelect: () => setChoices((c) => setChoice(c, k.stepId, x.id)) })) : [{ head: "No shared API key yet. Add one in the Vault." }], n.clientX ?? n.pageX ?? 0, n.clientY ?? n.pageY ?? 0, "other", { label: "Shared API keys" }); }}
                style={[s.pick, pointer]}
              >
                <Glyph name="key" size={13} color="var(--ink-3)" />
                <Text numberOfLines={1} style={[s.pickText, chosen === "" && { color: "var(--ink-3)" as string }]}>{label}</Text>
                <Glyph name="chevD" size={11} color="var(--ink-3)" />
              </Pressable>
            </View>
          );
        })}
        {d.grants.filter((g) => g.via !== "owner_access").length === 0 && d.vaultNames.length === 0 && d.connections.length === 0 && d.keysToReplace.length === 0 ? <Text style={s.dim}>Nothing new.</Text> : null}

        <Hint>History, versions and runs come with it. You stay the owner and can hand it off after. Anyone who can edit it is equally an owner.</Hint>
        {err ? <Text testID="promote-error" style={s.err}>{err}</Text> : null}
      </ScrollView>
      <View style={s.foot}>
        <Text style={s.footNote}>You can make a personal copy later.</Text>
        <View style={{ flex: 1 }} />
        <TextButton label="Cancel" testID="promote-cancel" onPress={onClose} />
        <TextButton label="Promote to Space" primary disabled={!ok} testID="promote-confirm" onPress={() => void promote()} />
      </View>
      {element}
    </>
  );
}

function DiffRow({ sign, text, sub, mono = false }: { sign: "+" | "-"; text: string; sub?: string; mono?: boolean }): ReactElement {
  return (
    <View style={s.diff} testID={`diff-${sign === "+" ? "add" : "drop"}`}>
      <Text style={[s.sign, { color: (sign === "+" ? "var(--ok)" : "var(--danger)") as string }]}>{sign === "+" ? "+" : "−"}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.strong2, mono && s.mono]}>{text}</Text>
        {sub ? <Text style={s.dim}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const s = StyleSheet.create({
  card: { width: 560, maxWidth: "100%", maxHeight: "92%", borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 10 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginTop: 2 },
  x: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: 20, paddingBottom: 14 },
  line: { flexDirection: "row", gap: 10, minHeight: 30, paddingTop: 4 },
  mark: { width: 14 },
  fl: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 4 },
  strong: { fontSize: 13, lineHeight: 18, fontWeight: "500", color: "var(--ink)" as string },
  strong2: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  mono: { fontFamily: MONO, fontSize: 12.5 },
  dim: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  err: { fontSize: 12.5, lineHeight: 18, color: "var(--danger)" as string, marginTop: 10 },
  diff: { flexDirection: "row", gap: 10, minHeight: 30, paddingVertical: 4, alignItems: "flex-start" },
  sign: { width: 14, fontSize: 14, lineHeight: 20, fontWeight: "600", fontFamily: MONO },
  keyRow: { flexDirection: "row", gap: 10, minHeight: 40, paddingVertical: 4, alignItems: "center" },
  pick: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 7, backgroundColor: "var(--hover)" as string, maxWidth: 210 },
  pickText: { fontSize: 12.5, color: "var(--ink)" as string, flexShrink: 1 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  footNote: { fontSize: 12, color: "var(--ink-3)" as string },
});
