// Console > Agents > Skills and plugins > Installed for the Space (owner, 4 Nov 2026; prototype pgSkills): one row for everything installed from a link, with its kind, who installed it, the source and commit,
// who it is for, Update when a newer commit exists and Remove. Every control calls install.*: list, check_update, from_link (the preview), apply (only after the preview) and remove.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { TextField } from "../../../../../ui/src/TextField/index.tsx";
import { Section, SmallButton } from "../../places/settings/ui.tsx";
import { changedCount, diffRows, needsLines, pinnedLine, shortOf } from "../../places/chats/install/model.ts";
import type { Plan } from "../../places/chats/install/model.ts";

type Call = (cap: string, input: Record<string, unknown>) => Promise<unknown>;
export interface Install { installId: string; kind: Plan["kind"]; name: string; repo: string; commit: string; url: string; by: string; at: number; installed: Record<string, unknown> }
type Who = "me" | "agent" | "space";

const key = (): string => globalThis.crypto?.randomUUID?.() ?? `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const quiet = { fontSize: 12, color: "var(--ink-3)", lineHeight: 17 } as const;
const mono = { fontSize: 12, color: "var(--ink-2)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 19 } as const;
const say = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

export const KIND_LABEL: Readonly<Record<Plan["kind"], string>> = { skill: "Skill", plugin: "Plugin", mcp_local: "MCP server", mcp_remote: "MCP server", site: "Site" };
/** Who the install is for, as the row says it. */
export function forWords(i: Install, nameOf: (id: string) => string): string {
  const f = i.installed["for"];
  if (f === "space") return "Everyone in the Space";
  if (f === "agent") return typeof i.installed["agentId"] === "string" ? `Only ${nameOf(i.installed["agentId"])}` : "One agent";
  return nameOf(i.by);
}
/** The confirm before Remove: it names who loses the item. */
export function loseWords(i: Install, nameOf: (id: string) => string): string {
  const f = i.installed["for"];
  if (f === "space") return "Everyone in the Space will lose it, and so will their agents.";
  if (f === "agent") return `${typeof i.installed["agentId"] === "string" ? nameOf(i.installed["agentId"]) : "The agent it was added for"} will lose it.`;
  return `${nameOf(i.by)} and their agents will lose it.`;
}
/** What an update newly reaches: it needs a person to look first. */
export const reaches = (p: Plan): string[] => [...p.needs.domains, ...p.needs.vaultKeys];

export function InstalledForSpace({ call, nameOf = (id) => id }: { call: Call; nameOf?: (id: string) => string }): ReactElement {
  const [rows, setRows] = useState<Install[] | null>(null);
  const [updates, setUpdates] = useState<Record<string, Plan>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState<Install | null>(null);
  const [removing, setRemoving] = useState<Install | null>(null);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [who, setWho] = useState<Who>("me");
  const [runOn, setRunOn] = useState<"sandbox" | "space">("sandbox");
  const [vault, setVault] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    let list: Install[] = [];
    try { list = ((await call("install.list", { all: true })) as { installs: Install[] }).installs; } catch { list = []; }
    setRows(list);
    const found: Record<string, Plan> = {};
    await Promise.all(list.filter((i) => i.kind !== "mcp_remote" && i.kind !== "site").map(async (i) => {
      try { const out = (await call("install.check_update", { installId: i.installId })) as { changed: boolean; plan?: Plan }; if (out.changed && out.plan) found[i.installId] = out.plan; } catch { /* not checked this time */ }
    }));
    setUpdates(found);
  }, [call]);
  useEffect(() => { void load(); }, [load]);

  const closeAdd = (): void => { setAdding(false); setLink(""); setPlan(null); setErr(null); setVault(""); setWho("me"); setRunOn("sandbox"); };
  const read = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try {
      const out = (await call("install.from_link", { url: link.trim() })) as { plan: Plan };
      setPlan(out.plan); setWho(out.plan.who.some((w) => w.key === "space" && w.allowed) ? "space" : "me");
    } catch (e) { setErr(say(e, "Could not read that link.")); } finally { setBusy(false); }
  };
  const needsKey = plan !== null && (plan.kind === "mcp_remote" || (plan.kind === "mcp_local" && runOn === "space"));
  const install = async (): Promise<void> => {
    if (!plan) return;
    setBusy(true); setErr(null);
    try {
      await call("install.apply", { planId: plan.planId, card: plan.card, for: who, ...(plan.kind === "mcp_local" ? { runOn } : {}), ...(vault.trim() !== "" ? { authHandle: vault.trim() } : {}), idempotencyKey: key() });
      setNote(`Installed ${plan.name}.`); closeAdd(); await load();
    } catch (e) { setErr(say(e, "Could not install it.")); } finally { setBusy(false); }
  };
  const update = async (): Promise<void> => {
    if (!updating) return;
    const p = updates[updating.installId];
    if (!p) return;
    setBusy(true);
    try {
      const f = updating.installed["for"];
      await call("install.apply", { planId: p.planId, card: p.card, for: f === "agent" || f === "me" ? f : "space", ...(typeof updating.installed["agentId"] === "string" ? { agentId: updating.installed["agentId"] } : {}), idempotencyKey: key() });
      setNote(`Updated ${updating.name} to ${shortOf(p.commit)}.`); setFailed(({ [updating.installId]: _, ...rest }) => rest); setUpdating(null); await load();
    } catch (e) { setFailed((was) => ({ ...was, [updating.installId]: say(e, "The update did not go through.") })); setUpdating(null); } finally { setBusy(false); }
  };
  const remove = async (): Promise<void> => {
    if (!removing) return;
    setBusy(true);
    try { await call("install.remove", { installId: removing.installId, idempotencyKey: key() }); setNote(`Removed ${removing.name}.`); setRemoving(null); await load(); }
    catch (e) { setNote(say(e, "Could not remove it.")); setRemoving(null); } finally { setBusy(false); }
  };

  const list = rows ?? [];
  const needsYou = (i: Install): string | null => {
    if (failed[i.installId]) return `Update failed. ${failed[i.installId]}`;
    const p = updates[i.installId];
    if (p && reaches(p).length > 0) return `The update wants to reach ${reaches(p).join(", ")}. Look before you update.`;
    return null;
  };
  const waiting = list.filter((i) => needsYou(i) !== null).length;
  const up = updating ? updates[updating.installId] : undefined;
  const pin = plan ? pinnedLine(plan) : null;
  const nl = plan ? needsLines(plan) : null;

  return <View testID="skills-installed">
    <Section title="Installed for the Space" testID="skills-installed-section" note={waiting > 0 ? `${waiting} ${waiting === 1 ? "needs" : "need"} you. Each item is pinned to the commit it was read at. Nothing updates by itself.` : "Each item is pinned to the commit it was read at. Nothing updates by itself."}>
      {rows === null ? <Text style={quiet}>Loading…</Text> : list.length === 0 ? (
        <View testID="installed-empty" style={{ gap: 8, padding: 12, alignItems: "flex-start" }}>
          <Text style={quiet}>Nothing installed yet. Install a skill, plugin or tool server from a link.</Text>
          <SmallButton primary label="Install" testID="installed-add-empty" onPress={() => setAdding(true)} />
        </View>
      ) : list.map((i) => {
        const hold = needsYou(i);
        const u = updates[i.installId];
        return <Row key={i.installId} id={`install-row-${i.installId}`} title={i.name}
          note={`${KIND_LABEL[i.kind]} · ${i.repo || i.url}${i.commit ? ` at ${shortOf(i.commit)}` : ""} · For ${forWords(i, nameOf)} · Installed by ${nameOf(i.by)}${u ? " · Update available" : ""}${hold ? ` · Needs you: ${hold}` : ""}`}
          trailing={<View style={{ flexDirection: "row", gap: 6 }}>
            {u ? <SmallButton label="Update" testID={`install-update-${i.installId}`} disabled={busy} onPress={() => setUpdating(i)} /> : null}
            <SmallButton label="Remove" danger testID={`install-remove-${i.installId}`} disabled={busy} onPress={() => setRemoving(i)} />
          </View>} />;
      })}
      {list.length > 0 ? <View style={{ padding: 12, alignItems: "flex-start" }}><SmallButton label="Install from a link" testID="installed-add" onPress={() => setAdding(true)} /></View> : null}
    </Section>
    {note ? <Text testID="skills-installed-note" style={quiet} accessibilityLiveRegion="polite">{note}</Text> : null}

    {updating && up ? (
      <Dialog title={`${updating.name} ${shortOf(up.diff?.from ?? updating.commit)} to ${shortOf(up.commit)}`} onClose={() => setUpdating(null)} width={600} fill testID="install-update-sheet"
        actions={[{ label: "Update", primary: true, disabled: busy, testID: "install-update-go", onPress: () => void update() }, { label: "Not now", onPress: () => setUpdating(null) }]}>
        <View style={{ gap: 6 }}>
          {up.diff ? <Text style={quiet}>{`${changedCount(up.diff)} ${changedCount(up.diff) === 1 ? "file" : "files"} changed`}</Text> : null}
          {reaches(up).length > 0 ? <Text style={quiet}>{`It reaches ${reaches(up).join(", ")}.`}</Text> : null}
          {/* ui-rows-lint: not a list (the lines of one update diff, monospace) */}
          {up.diff ? diffRows(up.diff).map((r, n) => <Text key={n} style={[mono, r.kind === "head" ? { color: "var(--ink-3)" } : null]}>{r.text}</Text>) : null}
        </View>
      </Dialog>
    ) : null}

    {removing ? (
      <Dialog title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)} width={440} testID="install-remove-sheet"
        actions={[{ label: "Remove", danger: true, disabled: busy, testID: "install-remove-go", onPress: () => void remove() }, { label: "Keep it", onPress: () => setRemoving(null) }]}>
        <Text testID="install-remove-who" style={quiet}>{loseWords(removing, nameOf)}</Text>
      </Dialog>
    ) : null}

    {adding ? (
      <Dialog title="Install from a link" onClose={closeAdd} width={560} fill testID="install-add-sheet"
        actions={plan
          ? [{ label: "Install", primary: true, disabled: busy || (needsKey && vault.trim() === ""), testID: "install-add-go", onPress: () => void install() }, { label: "Cancel", onPress: closeAdd }]
          : [{ label: "Read it", primary: true, disabled: busy || link.trim() === "", testID: "install-add-read", onPress: () => void read() }, { label: "Cancel", onPress: closeAdd }]}>
        <View style={{ gap: 8 }}>
          {plan && pin && nl ? <>
            <Text testID="install-preview-title" style={{ fontSize: 13.5, fontWeight: "600", color: "var(--ink)" }}>{`${plan.name} (${KIND_LABEL[plan.kind]})`}</Text>
            <Text style={quiet}>{plan.summary}</Text>
            <Text testID="install-preview-source" style={mono}>{`${plan.repo}${plan.path ? `/${plan.path}` : ""} · ${pin.label}: ${pin.value}`}</Text>
            <Text testID="install-preview-needs" style={quiet}>{`Network: ${nl.network}. Vault keys: ${nl.vault}.${nl.files !== "none" ? ` Files: ${nl.files}.` : ""}`}</Text>
            {plan.problems.length > 0 ? <Text style={quiet}>{`Heads up: ${plan.problems.slice(0, 2).join(" ")}`}</Text> : null}
            {/* ui-rows-lint: not a list (a segmented choice of where it runs) */}
            {plan.kind === "mcp_local" && plan.runOn ? <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>{plan.runOn.map((r) => <SmallButton key={r.key} label={r.key === "sandbox" ? "Run on my agent's computer" : r.label} primary={runOn === r.key} testID={`install-run-${r.key}`} onPress={() => setRunOn(r.key)} />)}</View> : null}
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <Text style={quiet}>For</Text>
              {/* ui-rows-lint: not a list (a segmented choice of who it is for) */}
              {plan.who.filter((w) => w.key !== "agent" && w.allowed).map((w) => <SmallButton key={w.key} label={w.key === "space" ? "Everyone in the Space" : "Just me"} primary={who === w.key} testID={`install-for-${w.key}`} onPress={() => setWho(w.key)} />)}
            </View>
            {needsKey ? <TextField accessibilityLabel="Vault key" testID="install-add-key" value={vault} onChangeText={setVault} placeholder="#Ops_mcp (a Vault key that protects it)" autoCapitalize="none" /> : null}
          </> : <>
            <Text style={quiet}>Paste a GitHub link or the address of a tool server. Nothing is installed until you have seen what it is.</Text>
            <TextField accessibilityLabel="Link" testID="install-add-link" value={link} onChangeText={setLink} placeholder="https://github.com/anthropics/skills/tree/main/pdf" autoCapitalize="none" />
          </>}
          {err ? <Text testID="install-add-error" style={{ fontSize: 12.5, color: "var(--danger)" }}>{err}</Text> : null}
        </View>
      </Dialog>
    ) : null}
  </View>;
}
