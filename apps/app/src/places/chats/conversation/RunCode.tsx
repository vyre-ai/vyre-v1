// Run on a code block in a message (rc.9): a small bar under a one-line shell block. A dot for what the command can do, a chip for the machine (this computer, the server, an agent's computer),
// and Run. A command that only reads runs and shows its output here; anything else is typed into that machine's terminal and waits for Enter, as the Run this card does (terminal/runthis.ts).
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { loadHosts } from "../terminal/hosts.ts";
import type { HostChoice } from "../terminal/hosts.ts";
import { RiskDot } from "../terminal/RiskDot.tsx";
import type { Risk } from "../terminal/RiskDot.tsx";
import { finish, riskOf, runThis } from "../terminal/runthis.ts";
import type { RunDeps } from "../terminal/request.ts";
import { Glyph, TextButton, anchorOf } from "./parts.tsx";
import type { GlyphName } from "./parts.tsx";

export interface RunCodeConfig {
  deps: RunDeps;
  team: boolean;
  nameOf(agentId: string): string;
  now(): number;
  /** The agent of this chat: its computer is the machine the chip offers first when the chat is with an agent that has one. */
  agentId?: string;
  copy(text: string): void;
  openTerminal(terminalId: string): void;
}

const ICON: Record<HostChoice["kind"], GlyphName> = { device: "monitor", server: "server", agent: "monitor" };
type State = { s: "idle" } | { s: "working" } | { s: "typed"; terminalId: string } | { s: "ran"; exitCode: number | null; output: string } | { s: "said"; text: string };

const TAIL = 1500;

export function RunCode({ command, cfg }: { command: string; cfg: RunCodeConfig }): ReactElement | null {
  const [hosts, setHosts] = useState<readonly HostChoice[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [st, setSt] = useState<State>({ s: "idle" });
  const { element, show } = useMenu();
  // the config is rebuilt with the page; the bar reads it as it is and asks again only for another command or another kind of Space
  const now = useRef(cfg);
  now.current = cfg;
  useEffect(() => {
    let live = true;
    const c = now.current;
    void loadHosts(c.deps.call, { team: c.team, now: c.now(), nameOf: c.nameOf }).then((h) => { if (live) setHosts(h); });
    void riskOf(c.deps, command).then((r) => { if (live) setRisk(r); });
    return () => { live = false; };
  }, [command, cfg.team]);
  const usable = hosts.filter((h) => h.online);
  const host = hosts.find((h) => h.key === pick) ?? usable.find((h) => h.kind === "device") ?? usable[0];
  if (!host) return null;
  const go = (): void => {
    if (st.s === "working") return;
    setSt({ s: "working" });
    void (async () => {
      try {
        const r = await runThis(cfg.deps, host, command, risk ?? "change");
        if (r.s === "ran") { setSt({ s: "ran", exitCode: r.exitCode, output: r.output }); return; }
        if (r.s === "refused") { setSt({ s: "said", text: r.why }); return; }
        setSt({ s: "typed", terminalId: r.terminalId });
        cfg.openTerminal(r.terminalId);
        const out = await finish(cfg.deps, r.terminalId, r.cursor, command);
        setSt({ s: "ran", exitCode: null, output: out });
      } catch { setSt({ s: "said", text: "Could not reach that machine." }); }
    })();
  };
  const entries = hosts.map((h) => ({ label: h.label, checked: h.key === host.key, ...(h.online ? {} : { disabled: true, ...(h.why ? { reason: h.why } : {}) }), onSelect: () => setPick(h.key) }));
  return (
    <View testID="run-code" style={s.bar}>
      {element}
      {risk ? <RiskDot risk={risk} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Runs on ${host.label}`} testID="run-code-host" {...(Platform.OS === "web" ? ({ title: `Runs on ${host.label}` } as object) : {})}
        onPress={(e) => { const p = anchorOf(e); show(entries, p.x, p.y, "other", { label: "Runs on" }); }} style={s.chip}>
        <Glyph name={ICON[host.kind]} size={13} color="var(--ink-2)" />
        <Text numberOfLines={1} style={s.chipText}>{host.label}</Text>
        <Glyph name="chevd" size={11} color="var(--ink-4)" />
      </Pressable>
      <View style={{ flex: 1 }} />
      <TextButton label="Copy" onPress={() => cfg.copy(command)} testID="run-code-copy" />
      {st.s === "typed" ? <TextButton label="Show" onPress={() => cfg.openTerminal(st.terminalId)} testID="run-code-show" /> : null}
      <TextButton label={st.s === "working" ? "Running" : "Run"} primary onPress={go} testID="run-code-run" />
      {st.s === "typed" ? <Text testID="run-code-wait" style={s.note}>Press Enter in the terminal</Text> : null}
      {st.s === "said" ? <Text accessibilityRole="alert" testID="run-code-said" style={s.err}>{st.text}</Text> : null}
      {st.s === "ran" ? (
        <View testID="run-code-out" style={s.out}>
          <Text selectable style={s.outText}>{st.output.length > TAIL ? `…${st.output.slice(-TAIL)}` : st.output === "" ? "No output" : st.output}</Text>
          {st.exitCode !== null && st.exitCode !== 0 ? <Text style={s.err}>{`Exit ${st.exitCode}`}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const s = StyleSheet.create({
  bar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: "var(--hover)" as string, maxWidth: 200 },
  chipText: { fontSize: 12, color: "var(--ink-2)" as string, flexShrink: 1 },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string, width: "100%" },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  out: { width: "100%", padding: 10, gap: 6, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  outText: { fontSize: 12.5, lineHeight: 17, color: "var(--ink)" as string, fontFamily: MONO },
});
