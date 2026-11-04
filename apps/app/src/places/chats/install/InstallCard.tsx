// The install card (owner, 4 Nov 2026; prototype r-install): an agent was given a link and read it into a plan; this is the card that waits for the person. It says what it is, what it does, what it needs,
// the exact commit and who gets it, then Install, Edit (the name agents will see) and Not now. After Install it is one quiet line with Open. An update is one quiet line, See changes, and a diff card
// with Update and Not now. The card reads its plan by id (install.get), so it is right after a reload and on another device.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ConversationData } from "../conversation/data.tsx";
import { TextButton } from "../conversation/parts.tsx";
import { Face } from "../needsyou/parts.tsx";
import { KIND_WORDS, SCOPES, choices, diffRows, doneLine, changedCount, needsLines, pinnedLine, shortOf, titleOf } from "./model.ts";
import type { Plan, RunOn, Scope } from "./model.ts";

export type InstallData = Pick<ConversationData, "call"> & { openSkills?(name: string): void; agentId?: string; /** the name of the Assistant whose face heads the card */ agentName?: string; say?(text: string): void };
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
  // the Vault keys the plan names that this person does not have yet: the install waits for them (prototype r-install, "Add it")
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [absent, setAbsent] = useState<readonly string[]>([]);
  const [keyOpen, setKeyOpen] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [keyLine, setKeyLine] = useState<string | null>(null);
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
  const wanted = plan?.needs.vaultKeys.join("\n") ?? "";
  // the keys are looked for when the card opens and again when the person comes back to this window (they may have added one in the Vault), so Install turns on by itself
  useEffect(() => {
    if (wanted === "") { setAbsent([]); return; }
    let live = true;
    const look = async (): Promise<void> => {
      const miss: string[] = [];
      for (const k of wanted.split("\n")) {
        try {
          const out = (await chat.call("vault.items.list", { q: k })) as { items?: Array<{ name?: string }> };
          if (!(out.items ?? []).some((i) => (i.name ?? "").toLowerCase() === k.toLowerCase())) miss.push(k);
        } catch { /* cannot tell: do not hold the install */ }
      }
      if (live) setAbsent(miss);
    };
    void look();
    const w = (globalThis as { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void });
    const again = (): void => { void look(); };
    w.addEventListener?.("focus", again);
    return () => { live = false; w.removeEventListener?.("focus", again); };
  }, [chat, wanted]);
  if (!b) return null;
  if (!plan) return <View testID={`install-loading-${id}`} style={st.quiet}><Text style={st.quietText}>{`Reading ${b.name}…`}</Text></View>;
  const shown = name ?? plan.name;

  if (state === "installed") {
    const text = b.update ? `Updated ${shown} to ${shortOf(plan.commit)}` : doneLine(shown, scope, plan.kind === "mcp_local" ? runOn : undefined);
    return (
      <View testID={`install-done-${id}`} style={st.quiet}>
        <Dot /><Text style={st.quietText}>{text}</Text>
        {chat.openSkills ? <Pressable accessibilityRole="link" testID={`install-open-${id}`} onPress={() => chat.openSkills?.(shown)}><Text style={st.link}>Open</Text></Pressable> : null}
      </View>
    );
  }
  if (state === "declined") {
    return (
      <View testID={`install-declined-${id}`} style={st.quiet}>
        <Dot /><Text style={st.quietText}>{`Did not install ${plan.name}. Nothing was added.`}</Text>
        <Pressable accessibilityRole="link" testID={`install-undo-${id}`} onPress={() => setState("planned")}><Text style={st.link}>Undo</Text></Pressable>
      </View>
    );
  }
  const needs = needsLines(plan);
  const pin = pinnedLine(plan);
  const missing = absent.filter((k) => !added.has(k));
  const saveKey = async (k: string): Promise<void> => {
    if (keyValue.trim() === "") return;
    try {
      const folders = (await chat.call("vault.folders.list", { scope: "mine" })) as { folders?: Array<{ id: string }> };
      const folderId = folders.folders?.[0]?.id;
      if (!folderId) { setKeyLine("Open Vault once to make your folder, then try again."); return; }
      await chat.call("vault.item.put", { folderId, name: k, kind: "other", fields: [{ key: k, value: keyValue.trim(), secret: true }], idempotencyKey: `install-key-${planId}-${k}-${++seq}` });
      setAdded(new Set([...added, k])); setKeyOpen(null); setKeyValue(""); setKeyLine(null);
    } catch (e) { setKeyLine(e instanceof Error && e.message ? e.message.replace(/\.$/, "") + "." : "Could not save it. Try again."); }
  };
  const needsKey = plan.kind === "mcp_local" && runOn === "space";
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
          <Dot /><Text style={st.quietText}>{`${plan.name} has an update`}</Text>
          <Pressable accessibilityRole="button" testID={`install-diff-toggle-${id}`} onPress={() => setDiff((x) => !x)}><Text style={st.link}>{diff ? "Hide changes" : "See changes"}</Text></Pressable>
        </View>
        {diff ? (
          <View testID={`install-diff-${id}`} style={st.card}>
            <View style={st.head2}>
              <Face name={chat.agentName ?? "Assistant"} size={22} />
              <View style={st.headText}>
                <Text accessibilityRole="header" style={st.title}>{titleOf(plan)}</Text>
                <Text style={st.summary}>{`${shortOf(d.from)} to ${shortOf(d.to)} · ${changedCount(d)} ${changedCount(d) === 1 ? "file" : "files"} changed`}</Text>
              </View>
            </View>
            <View style={st.diff}>
              {/* ui-rows-lint: not a list (the lines of one diff) */}
              {diffRows(d).map((r, i) => <Text key={i} style={[st.mono, r.kind === "head" && st.head, r.kind === "add" && st.add, r.kind === "del" && st.del]}>{r.text}</Text>)}
            </View>
            {(d.newAccess ?? []).length > 0 ? <Text testID={`install-newaccess-${id}`} style={st.sub}><Text style={st.warn}>New access:</Text>{` it now also reaches ${(d.newAccess ?? []).join(", ")}. Everything else is the same.`}</Text> : null}
            {mine ? <View style={st.row}>
              <TextButton label="Update" primary icon="check" disabled={busy} testID={`install-update-go-${id}`} onPress={() => { void install(); }} />
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
      <View style={st.head2}>
        <Face name={chat.agentName ?? "Assistant"} size={22} />
        <View style={st.headText}>
          <Text accessibilityRole="header" style={st.title}>{`Install ${shown} (${KIND_WORDS[plan.kind]})`}</Text>
          <Text testID={`install-summary-${id}`} style={st.summary}>{plan.summary}</Text>
        </View>
      </View>
      <View style={st.grid}>
        <Row k="Source" v={`${plan.repo}${plan.path ? `/${plan.path}` : ""}`} mono />
        <Row k="Needs" v={`Network: ${needs.network}\nVault: ${needs.vault}${needs.files !== "none" ? `\nFiles: ${needs.files}` : ""}`} testID={`install-needs-${id}`} />
        <Row k={pin.label} v={pin.value} mono={Boolean(plan.commit)} testID={`install-pin-${id}`} />
        {absent.length > 0 ? (
          <View style={st.rowLine} testID={`install-vault-${id}`}><Text style={st.k}>Vault</Text>
            <View style={st.keys}>
              {/* ui-rows-lint: not a list (the keys this install waits for, each with its own Add it) */}
              {absent.map((k) => (
                <View key={k} style={st.gap}>
                  <View style={st.row}>
                    <Text style={st.v}>{added.has(k) ? `${k} · added` : `${k} is not in your Vault`}</Text>
                    {!added.has(k) && keyOpen !== k ? <TextButton label="Add it" testID={`install-addkey-${k}-${id}`} onPress={() => { setKeyOpen(k); setKeyLine(null); }} /> : null}
                  </View>
                  {keyOpen === k ? (
                    <View style={st.gap}>
                      <TextInput value={keyValue} onChangeText={setKeyValue} secureTextEntry placeholder={`Paste ${k}`} accessibilityLabel={k} testID={`install-keyvalue-${k}-${id}`} style={st.input} />
                      <Text style={st.summary}>It stays in your Vault.</Text>
                      <View style={st.row}><TextButton label="Save to Vault" primary testID={`install-keysave-${k}-${id}`} onPress={() => { void saveKey(k); }} /><TextButton label="Cancel" onPress={() => { setKeyOpen(null); setKeyValue(""); }} /></View>
                      {keyLine ? <Text style={st.sub}>{keyLine}</Text> : null}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {plan.problems.length > 0 ? <Row k="Heads up" v={plan.problems.slice(0, 2).join(" ")} /> : null}
        {plan.kind === "mcp_local" && plan.runOn ? (
          <View style={st.rowLine}><Text style={st.k}>Run</Text>
            {/* ui-rows-lint: not a list (two pills of one choice) */}
            <View style={st.seg}>{plan.runOn.map((r) => <Pill key={r.key} on={runOn === r.key} label={r.key === "sandbox" ? "Run on my agent's computer" : "Run it on the Space (Sites)"} testID={`install-run-${r.key}-${id}`} onPress={() => setRunOn(r.key)} />)}</View>
          </View>
        ) : null}
        {plan.kind === "mcp_local" || plan.kind === "mcp_remote" || plan.kind === "plugin" || plan.kind === "skill" ? (
          <View style={st.rowLine}><Text style={st.k}>For</Text>
            {/* ui-rows-lint: not a list (the pills of one choice) */}
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
        <View style={st.btns}>
          <TextButton label="Install" primary icon="check" disabled={busy || missing.length > 0 || (needsKey && vault.trim() === "")} testID={`install-go-${id}`} onPress={() => { void install(); }} />
          <TextButton label="Edit" ring icon="edit" testID={`install-edit-${id}`} onPress={() => setEditing(true)} />
          <TextButton label="Don't install" testID={`install-no-${id}`} onPress={() => setState("declined")} />
        </View>
      ) : <Text style={st.sub}>Waiting for the person who asked.</Text>}
      {mine && !editing && missing.length > 0 ? <Text testID={`install-waits-${id}`} style={st.sub}>Add the key first.</Text> : null}
      {mine && !editing && missing.length === 0 && needsKey && vault.trim() === "" ? <Text testID={`install-waits-${id}`} style={st.sub}>Pick a key to continue.</Text> : null}
      {line ? <Text testID={`install-line-${id}`} style={st.sub}>{line}</Text> : null}
    </View>
  );
}

function Dot(): ReactElement { return <View aria-hidden style={st.dot} />; }
function Row({ k, v, mono = false, testID }: { k: string; v: string; mono?: boolean; testID?: string }): ReactElement {
  return <View style={st.rowLine} testID={testID}><Text style={st.k}>{k}</Text><Text style={[st.v, mono && st.mono2]}>{v}</Text></View>;
}
function Pill({ on, label, onPress, testID }: { on: boolean; label: string; onPress(): void; testID: string }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} testID={testID} onPress={onPress} style={[st.pill, on && st.pillOn]}><Text style={[st.pillText, on && st.pillTextOn]}>{label}</Text></Pressable>;
}

const st = StyleSheet.create({
  card: { borderRadius: 16, padding: 12, gap: 8, backgroundColor: "var(--sunk)" as string, maxWidth: 560 },
  head2: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  headText: { flex: 1, minWidth: 0, gap: 1 },
  summary: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  warn: { color: "var(--warn)" as string, fontWeight: "600" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4, var(--ink-3))" as string, marginRight: 2 },
  gap: { gap: 6 },
  title: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, color: "var(--ink-2)" as string, lineHeight: 18 },
  grid: { gap: 7, backgroundColor: "var(--bg)" as string, borderRadius: 10, padding: 10 },
  keys: { flex: 1, gap: 6 },
  rowLine: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  k: { width: 70, flexShrink: 0, fontSize: 13, color: "var(--ink-3)" as string },
  v: { flex: 1, fontSize: 13, lineHeight: 19, color: "var(--ink)" as string },
  mono2: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, color: "var(--ink-2)" as string },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 19, color: "var(--ink)" as string },
  head: { color: "var(--ink-3)" as string, marginTop: 4 },
  add: { backgroundColor: "var(--ok-wash, rgba(60,160,90,0.14))" as string },
  del: { backgroundColor: "var(--danger-wash, rgba(200,70,70,0.12))" as string, color: "var(--ink-2)" as string },
  diff: { backgroundColor: "var(--bg)" as string, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8 },
  seg: { flexDirection: "row", flexWrap: "wrap", gap: 2, padding: 2, borderRadius: 9, backgroundColor: "var(--hover)" as string, flexShrink: 1, flexGrow: 0, alignSelf: "flex-start", minWidth: 0, maxWidth: "100%" },
  pill: { height: 26, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  pillOn: { backgroundColor: "var(--raised)" as string },
  pillText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  pillTextOn: { color: "var(--ink)" as string },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 2, alignItems: "center" },
  btns: { flexDirection: "row", gap: 6, flexWrap: "nowrap", marginTop: 2, alignItems: "center" },
  edit: { gap: 6 },
  input: { flex: 1, height: 34, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 9, paddingHorizontal: 10, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string },
  quiet: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2, flexWrap: "wrap" },
  quietText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
});
