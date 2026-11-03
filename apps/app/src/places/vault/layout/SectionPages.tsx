// The Vault's own pages for two of its four sections (owner, 3 Nov; the north star is prototype/vyre-vault.html): Google and Microsoft (two cards, each with its state and one button, and the
// keys that belong to them), and Connections (apps and tool servers your agents can use; in a Team Space two tabs, My connections and Space connections, in a Personal Space one list). And the
// one quiet question the + asks in All: four rows, then the right picker.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useVaultData } from "./data.tsx";
import { Btn, Glyph, LogoTile } from "./parts.tsx";
import { Sheet } from "./Sheet.tsx";
import { ADD_CHOICES } from "./sections.ts";
import type { Section } from "./sections.ts";

interface Company { connected?: boolean; provider?: string; domain?: string; tenant?: string }

/** Google and Microsoft: the company connection for each (Workspace or 365: sign-in for everyone, domain-wide access or admin consent) and their keys below, listed by the caller. */
export function GoogleMicrosoftPage({ keys, onOpenCompany }: { keys: ReactElement | null; onOpenCompany?: () => void }): ReactElement {
  const data = useVaultData();
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    let live = true;
    void (data.call("company.status", {}) as Promise<Company>).then((c) => { if (live) setCompany(c); }, () => { if (live) setCompany({}); });
    return () => { live = false; };
  }, [data]);
  const team = data.personal !== true;
  const card = (which: "google" | "microsoft"): ReactElement => {
    const on = company?.connected === true && (company.provider ?? "").toLowerCase().startsWith(which === "google" ? "google" : "m");
    const name = which === "google" ? "Google" : "Microsoft";
    const rows = team
      ? which === "google" ? ["Sign in with Google for everyone", "Domain-wide access", "Each person's own Gmail, Calendar and Drive"] : ["Sign in with Microsoft for everyone", "Admin consent for the tenant", "Each person's own Outlook, Calendar and OneDrive"]
      : which === "google" ? ["Your Gmail, Calendar and Drive"] : ["Your Outlook, Calendar and OneDrive"];
    return (
      <View style={s.card} testID={`gm-${which}`}>
        <View style={s.cardHead}><LogoTile name={name} size={30} /><Text style={s.cardTitle}>{name}</Text></View>
        <Text style={s.quiet}>{company === null ? "Checking" : on ? `Connected${company.domain ? ` to ${company.domain}` : company.tenant ? ` to ${company.tenant}` : ""}` : "Not connected"}</Text>
        <View style={{ gap: 7 }}>{rows.map((r) => <View key={r} style={s.check}><Text style={[s.mark, on ? s.on : null]}>{on ? "✓" : "○"}</Text><Text style={s.checkText}>{r}</Text></View>)}</View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row" }}><Btn label={on ? "Manage" : `Connect ${name}`} primary={!on} onPress={() => onOpenCompany?.()} testID={`gm-${which}-go`} /></View>
      </View>
    );
  };
  return (
    <View style={s.page} testID="vault-gm">
      <Text style={s.sub}>{team ? "Your company's connection, and each person's own mail, calendar and files." : "Your own mail, calendar and files."}</Text>
      <View style={s.cards}>{card("google")}{card("microsoft")}</View>
      {keys}
    </View>
  );
}

interface Conn { connectionId: string; connector: string; title?: string; ownerKind?: string; state?: string }

/** Connections: apps and tool servers your agents can use. A Team Space has two tabs (yours and your agents', and the ones shared with everyone or a group); a Personal Space one list. */
export function ConnectionsPage({ tab, onTab }: { tab: "my" | "space"; onTab: (t: "my" | "space") => void }): ReactElement {
  const data = useVaultData();
  const [list, setList] = useState<readonly Conn[] | null>(null);
  useEffect(() => {
    let live = true;
    void (data.call("connections.list", {}) as Promise<{ connections: Conn[] }>).then((o) => { if (live) setList(o.connections); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, [data]);
  const team = data.personal !== true;
  const mine = (c: Conn): boolean => c.ownerKind !== "space";
  const shown = (list ?? []).filter((c) => !team || (tab === "my" ? mine(c) : !mine(c)));
  const tabs: Array<["my" | "space", string, number]> = [["my", "My connections", (list ?? []).filter(mine).length], ["space", "Space connections", (list ?? []).filter((c) => !mine(c)).length]];
  return (
    <View style={s.page} testID="vault-connections">
      <Text style={s.sub}>{`Apps and tool servers your agents can use.${team ? (tab === "my" ? " These are yours and your agents'." : " These are shared with everyone or a group, and admins manage them.") : ""}`}</Text>
      {team ? (
        <View style={s.tabs} accessibilityRole="tablist">
          {tabs.map(([k, label, n]) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => onTab(k)} style={[s.tab, tab === k ? s.tabOn : null]} testID={`conn-tab-${k}`}>
              <Text style={[s.tabText, tab === k ? s.tabTextOn : null]}>{label}<Text style={s.tabCount}>{`  ${n}`}</Text></Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={s.rows}>
        {list === null ? <Text style={[s.quiet, { padding: 14 }]}>Loading</Text> : shown.length === 0 ? <Text style={[s.quiet, { padding: 14 }]} testID="conn-empty">{team && tab === "space" ? "No connections shared with the Space yet." : "No connections yet. Press + to add one."}</Text> : shown.map((c) => (
          <Row
            key={c.connectionId} id={`conn-${c.connectionId}`} title={c.title ?? c.connector} note={c.connector}
            leading={<LogoTile name={c.connector} size={30} />}
            trailing={<Text style={[s.state, c.state === "active" ? s.on : null]}>{c.state === "active" ? "Connected" : c.state === "needs_reconnect" || c.state === "failing" ? "Needs a new key" : c.state ?? ""}</Text>}
          />
        ))}
      </View>
    </View>
  );
}

/** The + in All, Mine, a folder: one quiet question, four rows. */
export function AddChooser({ onPick, onClose }: { onPick: (s: Section) => void; onClose: () => void }): ReactElement {
  const mark: Record<Section, string> = { ai: "OpenAI", google: "Google", connections: "Slack", other: "" };
  return (
    <Sheet title="What are you adding?" onClose={onClose} testID="vault-add-choose">
      <View style={{ gap: 2 }}>
        {ADD_CHOICES.map((c) => (
          <Row
            key={c.target} id={`add-choose-${c.target}`} title={c.title} note={c.line} onPress={() => onPick(c.target)}
            leading={mark[c.target] ? <LogoTile name={mark[c.target]} size={32} /> : <View style={s.keyTile}><Glyph name="keys" size={16} color="var(--ink-2)" /></View>}
          />
        ))}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingBottom: 24, gap: 14, maxWidth: 880 },
  sub: { fontSize: 13, color: "var(--ink-3)" as string },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  card: { flexGrow: 1, flexBasis: 280, minHeight: 220, gap: 12, padding: 18, borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string },
  check: { flexDirection: "row", gap: 8, alignItems: "baseline" },
  mark: { width: 12, fontSize: 12, color: "var(--ink-4)" as string },
  on: { color: "var(--ok)" as string },
  checkText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  tabs: { flexDirection: "row", gap: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tab: { height: 36, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent", marginBottom: -1 },
  tabOn: { borderBottomColor: "var(--ink)" as string },
  tabText: { fontSize: 13, fontWeight: "500", color: "var(--ink-3)" as string },
  tabTextOn: { color: "var(--ink)" as string },
  tabCount: { fontWeight: "400", color: "var(--ink-4)" as string },
  rows: { borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  rowLine: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  rowName: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  state: { fontSize: 11.5, color: "var(--warn)" as string },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 9 },
  keyTile: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
});
