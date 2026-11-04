// The install card (owner, 4 Nov 2026; prototype r-install): an agent was given a link and read it into a plan; this is the card that waits for the person. It says what it is, what it does, what it needs,
// the exact commit and who gets it, then Install, Edit (the name agents will see) and Not now. After Install it is one quiet line with Open. An update is one quiet line, See changes, and a diff card
// with Update and Not now. The card reads its plan by id (install.get), so it is right after a reload and on another device.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ConversationData } from "../conversation/data.tsx";
import { Glyph, TextButton } from "../conversation/parts.tsx";
import { KIND_WORDS, SCOPES, choices, diffRows, doneLine, changedCount, needsLines, pinnedLine, shortOf, titleOf } from "./model.ts";
import type { Plan, RunOn, Scope } from "./model.ts";

export type InstallData = Pick<ConversationData, "call"> & { openSkills?(name: string): void; agentId?: string; say?(text: string): void };
export const isInstallPlan = (type: string): boolean => type === "install_plan";
interface Block { planId: string; name: string; update: boolean; installId?: string }
export function blockOf(data: unknown): Block | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (typeof d["planId"] !== "string" || typeof d["name"] !== "string") return null;
  return { planId: d["planId"], name: d["name"], update: d["update"] === true, ...(typeof d["installId"] === "string" ? { installId: d["installId"] } : {}) };
}
let seq = 0;

export function InstallCard({ id, data, chat, mine = true }: { id: string; data: unknown; chat: InstallData; /** this reader is who asked */ mine?: boolean }): ReactElement | null {
  const b = blockOf(data);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [state, setState] = useState<"planned" | "installed" | "declined">("planned");
  const [scope, setScope] = useState<Scope>("me");
  const [runOn, setRunOn] = useState<RunOn>("sandbox");
  const [name, setName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [vault, setVault] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [diff, setDiff] = useState(false);
  const planId = b?.planId ?? "";
  const read = useCallback(async (): Promise<void> => {
    if (planId === "") return;
    try {
      const out = (await chat.call("install.get", { planId })) as { plan: Plan };
      setPlan(out.plan);
      if (out.plan.state === "installed") setState("installed");
    } catch { /* the card stays as a quiet loading line */ }
  }, [chat, planId]);
  useEffect(() => { void read(); }, [read]);
  if (!b) return null;
  if (!plan) return <View testID={`install-loading-${id}`} style={st.quiet}><Text style={st.quietText}>{`Reading ${b.name}…`}</Text></View>;
  const shown = name ?? plan.name;

  if (state === "installed") {
    const text = b.update ? `Updated ${shown} to ${shortOf(plan.commit)}` : doneLine(shown, scope, plan.kind === "mcp_local" ? runOn : undefined);
    return (
      <View testID={`install-done-${id}`} style={st.quiet}>
        <Glyph name="check" size={13} /><Text style={st.quietText}>{text}</Text>
        {chat.openSkills ? <Pressable accessibilityRole="link" testID={`install-open-${id}`} onPress={() => chat.openSkills?.(shown)}><Text style={st.link}>Open</Text></Pressable> : null}
      </View>
    );
  }
  if (state === "declined") {
    return (
      <View testID={`install-declined-${id}`} style={st.quiet}>
        <Glyph name="check" size={13} /><Text style={st.quietText}>{`Did not install ${plan.name}. Nothing was added.`}</Text>
        <Pressable accessibilityRole="link" testID={`install-undo-${id}`} onPress={() => setState("planned")}><Text style={st.link}>Undo</Text></Pressable>
      </View>
    );
  }
  const needs = needsLines(plan);
  const pin = pinnedLine(plan);
  const needsKey = plan.kind === "mcp_remote" || (plan.kind === "mcp_local" && runOn === "space");
  const install = async (): Promise<void> => {
    setBusy(true);
    try {
      await chat.call("install.apply", { planId, for: scope, ...(scope === "agent" && chat.agentId ? { agentId: chat.agentId } : {}), ...(plan.kind === "mcp_local" ? { runOn } : {}), ...(vault.trim() !== "" ? { authHandle: vault.trim() } : {}), idempotencyKey: `install-${planId}-${++seq}` });
      setState("installed");
    } catch (e) { setLine(e instanceof Error && e.message ? e.message.replace(/\.$/, "") + "." : "Could not install. Try again."); } finally { setBusy(false); }
  };

  // an update: one quiet line, then the diff on See changes
  if (b.update && plan.diff) {
    const d = plan.diff;
    return (
      <View testID={`install-update-${id}`} style={st.gap}>
        <View style={st.quiet}>
          <Glyph name="check" size={13} /><Text style={st.quietText}>{`${plan.name} has an update`}</Text>
          <Pressable accessibilityRole="button" testID={`install-diff-toggle-${id}`} onPress={() => setDiff((x) => !x)}><Text style={st.link}>{diff ? "Hide changes" : "See changes"}</Text></Pressable>
        </View>
        {diff ? (
          <View testID={`install-diff-${id}`} style={st.card}>
            <Text accessibilityRole="header" style={st.title}>{titleOf(plan)}</Text>
            <Text style={st.sub}>{`${shortOf(d.from)} to ${shortOf(d.to)} · ${changedCount(d)} ${changedCount(d) === 1 ? "file" : "files"} changed`}</Text>
            <View style={st.diff}>
              {/* ui-rows-lint: not a list (the lines of a diff) */}
              {diffRows(d).map((r, i) => <Text key={i} style={[st.mono, r.kind === "head" && st.head, r.kind === "add" && st.add, r.kind === "del" && st.del]}>{r.text}</Text>)}
            </View>
            {plan.needs.domains.length + plan.needs.vaultKeys.length > 0 ? <Text style={st.sub}>{`It reaches ${[...plan.needs.domains, ...plan.needs.vaultKeys].join(", ")}.`}</Text> : null}
            {mine ? <View style={st.row}>
              <TextButton label="Update" primary disabled={busy} testID={`install-update-go-${id}`} onPress={() => { void install(); }} />
              <TextButton label="Not now" testID={`install-update-no-${id}`} onPress={() => setDiff(false)} />
            </View> : null}
            {line ? <Text testID={`install-line-${id}`} style={st.sub}>{line}</Text> : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View testID={`install-${id}`} accessibilityLabel={`Install ${plan.name}?`} style={st.card}>
      <Text accessibilityRole="header" style={st.title}>{`Install ${shown} (${KIND_WORDS[plan.kind]})`}</Text>
      <Text testID={`install-summary-${id}`} style={st.sub}>{plan.summary}</Text>
      <View style={st.grid}>
        <Row k="Source" v={`${plan.repo}${plan.path ? `/${plan.path}` : ""}`} mono />
        <Row k="Needs" v={`Network: ${needs.network}\nVault: ${needs.vault}${needs.files !== "none" ? `\nFiles: ${needs.files}` : ""}`} testID={`install-needs-${id}`} />
        <Row k={pin.label} v={pin.value} mono={Boolean(plan.commit)} testID={`install-pin-${id}`} />
        {plan.problems.length > 0 ? <Row k="Heads up" v={plan.problems.slice(0, 2).join(" ")} /> : null}
        {plan.kind === "mcp_local" && plan.runOn ? (
          <View style={st.rowLine}><Text style={st.k}>Run</Text>
            {/* ui-rows-lint: not a list (a segmented choice of where it runs) */}
            <View style={st.seg}>{plan.runOn.map((r) => <Pill key={r.key} on={runOn === r.key} label={r.key === "sandbox" ? "Run on my agent's computer" : r.label} testID={`install-run-${r.key}-${id}`} onPress={() => setRunOn(r.key)} />)}</View>
          </View>
        ) : null}
        {plan.kind === "mcp_local" || plan.kind === "mcp_remote" || plan.kind === "plugin" || plan.kind === "skill" ? (
          <View style={st.rowLine}><Text style={st.k}>For</Text>
            {/* ui-rows-lint: not a list (a segmented choice of who it is for) */}
            <View style={st.seg}>{choices(plan).filter((c) => c.allowed || c.key !== "space").map((c) => <Pill key={c.key} on={scope === c.key} label={SCOPES.find((x) => x.key === c.key)?.label ?? c.label} testID={`install-for-${c.key}-${id}`} onPress={() => setScope(c.key)} />)}</View>
          </View>
        ) : null}
        {needsKey ? (
          <View style={st.rowLine}><Text style={st.k}>Key</Text>
            <TextInput value={vault} onChangeText={setVault} placeholder="#Ops_mcp (a Vault key that protects it)" accessibilityLabel="Vault key" testID={`install-key-${id}`} style={st.input} /></View>
        ) : null}
      </View>
      {editing ? (
        <View style={st.edit}>
          <TextInput value={name ?? plan.name} onChangeText={setName} accessibilityLabel="Name to install it as" testID={`install-name-${id}`} style={st.input} />
          <Text style={st.sub}>The name agents see. Nothing else changes.</Text>
          <View style={st.row}><TextButton label="Save" primary testID={`install-name-save-${id}`} onPress={() => setEditing(false)} /><TextButton label="Cancel" onPress={() => { setName(null); setEditing(false); }} /></View>
        </View>
      ) : mine ? (
        <View style={st.row}>
          <TextButton label="Install" primary disabled={busy || (needsKey && vault.trim() === "")} testID={`install-go-${id}`} onPress={() => { void install(); }} />
          <TextButton label="Edit" testID={`install-edit-${id}`} onPress={() => setEditing(true)} />
          <TextButton label="Not now" testID={`install-no-${id}`} onPress={() => setState("declined")} />
        </View>
      ) : <Text style={st.sub}>Waiting for the person who asked.</Text>}
      {line ? <Text testID={`install-line-${id}`} style={st.sub}>{line}</Text> : null}
    </View>
  );
}

function Row({ k, v, mono = false, testID }: { k: string; v: string; mono?: boolean; testID?: string }): ReactElement {
  return <View style={st.rowLine} testID={testID}><Text style={st.k}>{k}</Text><Text style={[st.v, mono && st.mono2]}>{v}</Text></View>;
}
function Pill({ on, label, onPress, testID }: { on: boolean; label: string; onPress(): void; testID: string }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} testID={testID} onPress={onPress} style={[st.pill, on && st.pillOn]}><Text style={[st.pillText, on && st.pillTextOn]}>{label}</Text></Pressable>;
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 12, padding: 12, gap: 8, backgroundColor: "var(--raised)" as string, maxWidth: 560 },
  gap: { gap: 6 },
  title: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, color: "var(--ink-2)" as string, lineHeight: 18 },
  grid: { gap: 7, backgroundColor: "var(--bg)" as string, borderRadius: 10, padding: 10 },
  rowLine: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  k: { width: 70, fontSize: 13, color: "var(--ink-3)" as string },
  v: { flex: 1, fontSize: 13, lineHeight: 19, color: "var(--ink)" as string },
  mono2: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, color: "var(--ink-2)" as string },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 19, color: "var(--ink)" as string },
  head: { color: "var(--ink-3)" as string, marginTop: 4 },
  add: { backgroundColor: "var(--ok-wash, rgba(60,160,90,0.14))" as string },
  del: { backgroundColor: "var(--danger-wash, rgba(200,70,70,0.12))" as string, color: "var(--ink-2)" as string },
  diff: { backgroundColor: "var(--bg)" as string, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8 },
  seg: { flexDirection: "row", flexWrap: "wrap", gap: 2, padding: 2, borderRadius: 9, backgroundColor: "var(--hover)" as string, flexShrink: 1 },
  pill: { height: 26, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  pillOn: { backgroundColor: "var(--raised)" as string },
  pillText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  pillTextOn: { color: "var(--ink)" as string },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 2 },
  edit: { gap: 6 },
  input: { flex: 1, height: 34, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 9, paddingHorizontal: 10, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string },
  quiet: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2, flexWrap: "wrap" },
  quietText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
});
