// Console > Agents > Skills and plugins > Installed from links (owner, 4 Nov 2026; prototype pgSkills): everything installed in this Space from a GitHub link or an MCP address, who installed it, the commit
// it is pinned to, See changes (an update's diff, applied only when an admin says so) and Remove. Reads install.list for the whole Space.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { Dialog } from "../../../../ui/src/Dialog/index.tsx";
import { Row } from "../../../../ui/src/Row/index.tsx";
import { Section, SmallButton } from "../places/settings/ui.tsx";
import { changedCount, diffRows, shortOf } from "../places/chats/install/model.ts";
import { Glyph } from "../places/chats/conversation/parts.tsx";
import type { Plan } from "../places/chats/install/model.ts";
import type { Call } from "./model.ts";

interface Install { installId: string; kind: Plan["kind"]; name: string; version?: string; repo: string; commit: string; url: string; by: string; at: number; installed: Record<string, unknown> }
const key = (): string => globalThis.crypto?.randomUUID?.() ?? `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const KIND_SHORT: Readonly<Record<Plan["kind"], string>> = { skill: "Skill", plugin: "Plugin", mcp_local: "MCP server", mcp_remote: "Remote MCP", site: "Site" };
const FOR_WORDS: Readonly<Record<string, string>> = { me: "you", agent: "one agent", space: "Everyone in the Space" };
const dayOf = (at: number): string => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const quiet = { fontSize: 12, color: "var(--ink-3)", lineHeight: 17 } as const;
const mono = { fontSize: 12, color: "var(--ink-2)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 19 } as const;

/** A quiet button with no outline: Remove is red only in its confirm, never here. */
function GhostButton({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID: string }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled === true }} disabled={disabled} testID={testID} onPress={onPress} style={{ height: 28, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{label}</Text></Pressable>;
}

export function InstalledFromLinks({ call, nameOf = (id) => id }: { call: Call; nameOf?: (id: string) => string }): ReactElement | null {
  const [rows, setRows] = useState<Install[] | null>(null);
  const [update, setUpdate] = useState<{ install: Install; plan: Plan } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // a row has an update when a newer commit exists; looked at once, a few at a time, and only then does the row say so
  const [ready, setReady] = useState<Record<string, { version: string }>>({});
  const load = useCallback(async (): Promise<void> => {
    try { setRows(((await call("install.list", { all: true })) as { installs: Install[] }).installs); } catch { setRows([]); }
  }, [call]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const i of (rows ?? []).filter((x) => x.kind !== "mcp_remote").slice(0, 6)) {
        const out = (await call("install.check_update", { installId: i.installId }).catch(() => null)) as { changed: boolean; plan?: Plan } | null;
        if (live && out?.changed && out.plan) setReady((r) => ({ ...r, [i.installId]: { version: out.plan?.version ?? shortOf(out.plan?.commit ?? "") } }));
      }
    })();
    return () => { live = false; };
  }, [rows, call]);
  if (rows === null || rows.length === 0) return null;

  const see = async (i: Install): Promise<void> => {
    setBusy(true); setNote(null);
    try {
      const out = (await call("install.check_update", { installId: i.installId })) as { changed: boolean; plan?: Plan };
      if (!out.changed || !out.plan) setNote(`${i.name} is up to date.`); else setUpdate({ install: i, plan: out.plan });
    } catch (e) { setNote(e instanceof Error && e.message ? e.message : "Could not look for changes."); } finally { setBusy(false); }
  };
  const apply = async (): Promise<void> => {
    if (!update) return;
    setBusy(true);
    try {
      await call("install.apply", { planId: update.plan.planId, for: "space", card: update.plan.card, idempotencyKey: key() });
      setNote(`Updated ${update.install.name} to ${shortOf(update.plan.commit)}.`); setUpdate(null); await load();
    } catch (e) { setNote(e instanceof Error && e.message ? e.message : "Could not update."); } finally { setBusy(false); }
  };
  const remove = async (i: Install): Promise<void> => {
    setBusy(true);
    try { await call("install.remove", { installId: i.installId, idempotencyKey: key() }); setNote(`Removed ${i.name}.`); await load(); }
    catch (e) { setNote(e instanceof Error && e.message ? e.message : "Could not remove it."); } finally { setBusy(false); }
  };

  return <View testID="skills-installed">
    <Section title="Installed from links" testID="skills-installed-section" note="Each is pinned to the commit it was read at. Nothing updates by itself: See changes shows what a newer commit does first.">
      {rows.map((i) => (
        <Row key={i.installId} id={`install-row-${i.installId}`} tall title={i.name} titleSuffix={KIND_SHORT[i.kind]}
          {...(ready[i.installId] ? { titleMarks: <Text testID={`install-ready-${i.installId}`} style={{ fontSize: 12, color: "var(--accent)" }}>{`v${ready[i.installId]!.version.replace(/^v/, "")} is ready`}</Text> } : {})}
          note={`${nameOf(i.by)} installed it ${dayOf(i.at)} · for ${FOR_WORDS[String(i.installed["for"] ?? "me")] ?? "you"} · ${i.commit ? `Commit ${shortOf(i.commit)}` : i.repo || i.url}${i.version ? ` · v${i.version.replace(/^v/, "")}` : ""}`}
          leading={<View style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" }}><Glyph name={i.kind === "skill" ? "spark" : "plug"} size={15} color="var(--ink-2)" /></View>}
          trailing={<View style={{ flexDirection: "row", gap: 6 }}>
            {ready[i.installId] ? <SmallButton label="See changes" testID={`install-see-${i.installId}`} disabled={busy} onPress={() => void see(i)} /> : null}
            <GhostButton label="Remove" testID={`install-remove-${i.installId}`} disabled={busy} onPress={() => void remove(i)} />
          </View>} />
      ))}
    </Section>
    {note ? <Text testID="skills-installed-note" style={quiet} accessibilityLiveRegion="polite">{note}</Text> : null}
    {update ? (
      <Dialog title={`${update.install.name} ${update.plan.diff?.fromVersion ?? shortOf(update.plan.diff?.from ?? "")} to ${update.plan.diff?.toVersion ?? shortOf(update.plan.diff?.to ?? "")}`} onClose={() => setUpdate(null)} width={600} fill testID="install-update-sheet"
        actions={[{ label: "Update", primary: true, disabled: busy, onPress: () => void apply() }, { label: "Not now", onPress: () => setUpdate(null) }]}>
        <View style={{ gap: 6 }}>
          <Text style={quiet}>{update.plan.diff ? `${changedCount(update.plan.diff)} ${changedCount(update.plan.diff) === 1 ? "file" : "files"} changed` : ""}</Text>
          {/* ui-rows-lint: not a list (the lines of one diff) */}
          {update.plan.diff ? diffRows(update.plan.diff).map((r, n) => <Text key={n} style={[mono, r.kind === "head" ? { color: "var(--ink-3)" } : null]}>{r.text}</Text>) : null}
        </View>
      </Dialog>
    ) : null}
  </View>;
}
