// Vault > Connections, Add a connection (owner rulings D28 and D29). Three ways in: Browse the MCP registry (searched as you type, from the last fetch when offline), Paste an address (an https
// URL, or a command such as npx -y @acme/server or uvx acme-mcp), or Import a Claude Code or Codex config (.mcp.json, ~/.claude.json, ~/.codex/config.toml). Each becomes a draft; the setup
// step asks for what it needs (keys go into the Vault, never into the command line), who it is for (Mine, or the Space for those who may add one), then adds it and checks it. A server that
// signs in with OAuth gets a Sign in button.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { TextStyle } from "react-native";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { planEntry } from "../../../../../../lib/mcp-registry.ts";
import type { CatalogEntry } from "../../../../../../lib/mcp-registry.ts";
import { parseAddress, parseConfig } from "../../../../../../lib/mcp-import.ts";
import type { ConnectionDraft } from "../../../../../../lib/mcp-import.ts";
import { useOnline, useVaultData } from "../layout/data.tsx";
import { Btn, Glyph, Mono } from "../layout/parts.tsx";
import { Sheet } from "../layout/Sheet.tsx";
import { addFromPlan, messageOf, signIn } from "./actions.ts";
import type { Added } from "./actions.ts";
import { dotColor, healthWords } from "./model.ts";

export type Way = "browse" | "paste" | "import";
type Entry = CatalogEntry & { allowed: boolean };
interface Search { entries: Entry[]; offline: boolean; fetchedAt?: number; next?: string }

export interface Pending { draft: ConnectionDraft; title?: string; source: "registry" | "paste" | "import"; sourceRef?: string; oauth: boolean; asks: Array<{ key: string; secret: boolean; required: boolean; description: string; into: "env" | "header"; prefix?: string }> }

/** A registry entry as a draft: the remote (and its headers) or the package (and its env), with what it asks for. */
export function pendingFromEntry(e: CatalogEntry): Pending {
  const plan = planEntry(e);
  const draft: ConnectionDraft = { name: plan.name, ...(plan.url ? { url: plan.url, transport: "http" as const } : { command: plan.command!, args: plan.args }), args: plan.url ? [] : plan.args, env: {}, headers: {}, secrets: [], needs: [] };
  const asks = plan.asks.map((a) => {
    const prefix = a.into === "header" && a.value && /\{[^}]+\}/.test(a.value) ? a.value.slice(0, a.value.search(/\{/)) : undefined;
    return { key: a.name, secret: a.secret, required: a.required, description: a.description, into: a.into, ...(prefix ? { prefix } : {}) };
  });
  for (const a of asks) draft.needs.push({ key: a.key, into: a.into, secret: a.secret, ...(a.prefix ? { prefix: a.prefix } : {}) });
  return { draft, title: plan.title, source: "registry", sourceRef: e.name, oauth: plan.oauth, asks };
}

/** A pasted or imported draft: what it still needs (a ${VAR} the config left out) and the keys found in it (which go to the Vault as they are). */
export function pendingFromDraft(d: ConnectionDraft, source: "paste" | "import"): Pending {
  return { draft: d, source, ...(d.from ? { sourceRef: d.from } : {}), oauth: false, asks: d.needs.map((n) => ({ key: n.key, secret: n.secret, required: true, description: "", into: n.into, ...(n.prefix ? { prefix: n.prefix } : {}) })) };
}

/** Where the sheet starts: a way in, text already pasted, or a server already picked (an address that asked for one, a screenshot mount). */
export interface AddInitial { way?: Way; text?: string; query?: string; pending?: Pending[] }

export function AddConnection({ canAddSpace, onClose, onAdded, initial }: { canAddSpace: boolean; onClose(): void; onAdded(text: string): void; initial?: AddInitial }): ReactElement {
  const data = useVaultData();
  const online = useOnline();
  const [way, setWay] = useState<Way>(initial?.way ?? "browse");
  const [queue, setQueue] = useState<Pending[]>(initial?.pending ?? []);
  const [done, setDone] = useState<Array<{ title: string; added: Added }>>([]);
  const current = queue[0];
  const next = (added?: { title: string; added: Added }): void => { if (added) setDone((d) => [...d, added]); setQueue((q) => q.slice(1)); };
  const title = current ? `Add ${current.title ?? current.draft.name}` : done.length > 0 ? "Added" : "Add a connection";
  return (
    <Sheet title={title} onClose={onClose} testID="connection-add-sheet" icon={<Glyph name="plus" size={15} color="var(--accent)" />}>
      {current ? <Setup key={`${current.draft.name}-${queue.length}`} pending={current} canAddSpace={canAddSpace} onSkip={() => next()} onAdded={(t, a) => { onAdded(`Added ${t}`); next({ title: t, added: a }); }} />
        : done.length > 0 ? <Done done={done} onClose={onClose} onMore={() => setDone([])} />
        : (
          <>
            <Ways way={way} onChange={setWay} />
            {way === "browse" ? <Browse online={online} initialQuery={initial?.query ?? ""} onPick={(e) => setQueue([pendingFromEntry(e)])} />
              : way === "paste" ? <Paste initialText={initial?.way === "paste" ? initial.text ?? "" : ""} onPick={(ds) => setQueue(ds.map((d) => pendingFromDraft(d, "paste")))} />
              : <Import initialText={initial?.way === "import" ? initial.text ?? "" : ""} onPick={(ds) => setQueue(ds.map((d) => pendingFromDraft(d, "import")))} />}
          </>
        )}
      {!data.assistantId ? <Text style={s.quiet}>Vyre checks each connection through your assistant once it is added.</Text> : null}
    </Sheet>
  );
}

/** Three equal ways in: an inset segmented control, not pills. */
function Ways({ way, onChange }: { way: Way; onChange(w: Way): void }): ReactElement {
  const opt = (w: Way, label: string): ReactElement => (
    <Pressable key={w} accessibilityRole="tab" accessibilityState={{ selected: way === w }} onPress={() => onChange(w)} testID={`connection-way-${w}`} style={[s.seg, way === w && s.segOn]}>
      <Text style={[s.segText, way === w && s.segTextOn]}>{label}</Text>
    </Pressable>
  );
  return <View style={s.segs} accessibilityRole="tablist">{[opt("browse", "Browse"), opt("paste", "Paste an address"), opt("import", "Import a config")]}</View>;
}

function Browse({ online, onPick, initialQuery }: { online: boolean; onPick(e: Entry): void; initialQuery: string }): ReactElement {
  const data = useVaultData();
  const [q, setQ] = useState(initialQuery);
  const [res, setRes] = useState<Search | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void data.call("plugins.registry.search", { q, limit: 30 }).then((r) => { if (mine === seq.current) { setRes(r as Search); setError(""); } }, (e) => { if (mine === seq.current) setError(messageOf(e)); });
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, data]);
  const rows: ReactElement[] = [];
  for (const e of res?.entries ?? []) {
    const how = e.signIn === "oauth" ? "Signs in with your account" : e.signIn === "key" ? "Needs a key" : "No sign-in";
    const runs = e.remote ? "Remote" : e.package ? `Runs with ${e.package.runner}` : "";
    rows.push(<Row key={e.id} id={`catalog-${e.name}`} title={e.title} titleSuffix={e.name} note={`${e.description || "No description"} · ${how}${runs ? ` · ${runs}` : ""}${e.allowed ? "" : " · Not on your Space's list"}`} onPress={() => { if (e.allowed) onPick(e); }} trailing={e.allowed ? <Glyph name="chevron" /> : <Glyph name="lock" />} />);
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={s.search}>
        <Glyph name="search" size={14} />
        <TextInput placeholderTextColor="var(--ink-4)" value={q} onChangeText={setQ} placeholder="Search the MCP Registry: Notion, GitHub, Linear…" accessibilityLabel="Search the MCP Registry" style={s.searchInput} autoFocus testID="catalog-search" />
      </View>
      {res?.offline ? <Text style={s.quiet} testID="catalog-offline">{`Offline: showing the catalog as last fetched${res.fetchedAt ? `, ${new Date(res.fetchedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}.`}</Text> : null}
      {!online && !res ? <Text style={s.quiet}>Offline. The catalog shows once the Space answers.</Text> : null}
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
      <View testID="catalog-results">{res && rows.length === 0 ? <Text style={s.quiet}>{q ? `Nothing in the registry matches ${q}.` : "The registry is empty."}</Text> : rows}</View>
      <Text style={s.quiet}>From the official MCP Registry (registry.modelcontextprotocol.io).</Text>
    </View>
  );
}

function Paste({ onPick, initialText }: { onPick(ds: ConnectionDraft[]): void; initialText: string }): ReactElement {
  const [text, setText] = useState(initialText);
  const drafts = text.trim() ? parseAddress(text) : null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>An https address, or the command that starts the server</Text>
      <TextInput placeholderTextColor="var(--ink-4)" value={text} onChangeText={setText} multiline placeholder={"https://mcp.linear.app/mcp\nnpx -y @modelcontextprotocol/server-github\nuvx mcp-server-fetch"} accessibilityLabel="Address or command" style={[s.input, s.area]} autoFocus testID="paste-input" />
      {text.trim() && !drafts ? <Text style={s.error} accessibilityRole="alert">That is not an address or a command Vyre can run. Try an https URL, or a line starting with npx, uvx or docker.</Text> : null}
      {drafts ? <DraftRows drafts={drafts} /> : null}
      <View style={s.actions}><View style={{ flex: 1 }} /><Btn label="Continue" primary disabled={!drafts || drafts.every((d) => d.problem)} onPress={() => drafts && onPick(drafts.filter((d) => !d.problem))} testID="paste-continue" /></View>
    </View>
  );
}

function Import({ onPick, initialText }: { onPick(ds: ConnectionDraft[]): void; initialText: string }): ReactElement {
  const [text, setText] = useState(initialText);
  const [off, setOff] = useState<Set<string>>(new Set());
  const parsed = text.trim() ? parseConfig(text) : null;
  const choose = (): void => {
    const doc = (globalThis as { document?: { createElement(t: string): { type: string; accept: string; onchange: (() => void) | null; click(): void; files?: { 0?: { text(): Promise<string> } } } } }).document;
    if (!doc) return;
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = ".json,.toml,application/json,text/plain";
    input.onchange = () => { void input.files?.[0]?.text().then(setText); };
    input.click();
  };
  const picked = (parsed?.drafts ?? []).filter((d) => !d.problem && !off.has(d.name));
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>Paste the file, or choose it: .mcp.json in a project, ~/.claude.json, or ~/.codex/config.toml</Text>
      <TextInput placeholderTextColor="var(--ink-4)" value={text} onChangeText={setText} multiline placeholder={'{ "mcpServers": { … } }  or  [mcp_servers.name]'} accessibilityLabel="Config file" style={[s.input, s.area, { minHeight: 140 }]} testID="import-input" />
      <View style={s.actions}><Btn label="Choose a file…" icon="file" onPress={choose} testID="import-choose" /><View style={{ flex: 1 }} /></View>
      {parsed?.error ? <Text style={s.error} accessibilityRole="alert">{parsed.error}</Text> : null}
      {parsed && parsed.drafts.length > 0 ? <DraftRows drafts={parsed.drafts} off={off} onToggle={(n) => setOff((o) => { const x = new Set(o); if (x.has(n)) x.delete(n); else x.add(n); return x; })} /> : null}
      <View style={s.actions}><View style={{ flex: 1 }} /><Btn label={picked.length > 1 ? `Add ${picked.length}` : "Continue"} primary disabled={picked.length === 0} onPress={() => onPick(picked)} testID="import-continue" /></View>
    </View>
  );
}

/** What was found: one row per server, with its address (keys left out) and what it still needs. */
function DraftRows({ drafts, off, onToggle }: { drafts: readonly ConnectionDraft[]; off?: ReadonlySet<string>; onToggle?(name: string): void }): ReactElement {
  const rows: ReactElement[] = [];
  for (const d of drafts) {
    const where = d.url ?? [d.command, ...d.args].join(" ");
    const extra = d.problem ?? [d.secrets.length ? `${d.secrets.length} ${d.secrets.length === 1 ? "key goes" : "keys go"} to the Vault` : "", d.needs.length ? `needs ${d.needs.map((n) => n.key).join(", ")}` : "", d.from ? `from ${d.from}` : ""].filter(Boolean).join(" · ");
    const on = !d.problem && !(off?.has(d.name) ?? false);
    rows.push(<Row key={d.name} id={`draft-${d.name}`} title={d.name} titleSuffix={where} note={extra || "Ready to add"} onPress={() => { if (!d.problem) onToggle?.(d.name); }} trailing={onToggle ? <Glyph name={on ? "check" : "x"} color={on ? "var(--ok)" : "var(--ink-4)"} /> : d.problem ? <Glyph name="x" color="var(--danger)" /> : <Glyph name="check" color="var(--ok)" />} />);
  }
  return <View testID="draft-rows">{rows}</View>;
}

function Setup({ pending, canAddSpace, onSkip, onAdded }: { pending: Pending; canAddSpace: boolean; onSkip(): void; onAdded(title: string, a: Added): void }): ReactElement {
  const data = useVaultData();
  const d = pending.draft;
  const [name, setName] = useState(d.name);
  const [scope, setScope] = useState<"mine" | "space">("mine");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Added | null>(null);
  const missing = pending.asks.filter((a) => a.required && (typed[a.key] ?? "").trim() === "");
  const titleText = pending.title ?? d.name;
  const add = async (): Promise<void> => {
    setBusy(true); setError("");
    try {
      const a = await addFromPlan(data.call, { scope, name: name.trim(), ...(pending.title ? { title: pending.title } : {}), draft: d, typed, oauth: pending.oauth, source: pending.source, ...(pending.sourceRef ? { sourceRef: pending.sourceRef } : {}) }, data.assistantId);
      setAdded(a);
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  };
  if (added) {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin ?? "";
    return (
      <View style={{ gap: 10 }} testID="connection-added">
        <View style={s.result}><View style={[s.dot, { backgroundColor: dotColor(added.health) as string }]} /><Text style={s.resultText}>{`${titleText}: ${healthWords(added.health, added.tools)}`}</Text></View>
        {added.note && added.health !== "ok" ? <Text style={s.quiet}>{added.note}</Text> : null}
        <View style={s.actions}>
          {added.health === "needs_signin" ? <Btn label="Sign in" primary onPress={() => { void signIn(data.call, added.connectionId, origin).then((u) => Linking.openURL(u), (e) => setError(messageOf(e))); }} testID="connection-signin" /> : null}
          <View style={{ flex: 1 }} />
          <Btn label="Done" primary={added.health !== "needs_signin"} onPress={() => onAdded(titleText, added)} testID="connection-done" />
        </View>
        {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
      </View>
    );
  }
  const fields: ReactElement[] = [];
  for (const a of pending.asks) {
    fields.push(
      <View key={a.key} style={{ gap: 4 }}>
        <Text style={s.label}>{`${a.key}${a.required ? "" : " (optional)"}${a.secret ? " · goes into your Vault" : ""}`}</Text>
        <TextInput placeholderTextColor="var(--ink-4)" value={typed[a.key] ?? ""} onChangeText={(v) => setTyped((t) => ({ ...t, [a.key]: v }))} secureTextEntry={a.secret} placeholder={a.description || (a.secret ? "Paste the key" : "Value")} accessibilityLabel={a.key} style={s.input} testID={`ask-${a.key}`} />
      </View>,
    );
  }
  return (
    <View style={{ gap: 10 }} testID="connection-setup">
      <View style={{ gap: 4 }}>
        <Text style={s.label}>Name agents see</Text>
        <TextInput placeholderTextColor="var(--ink-4)" value={name} onChangeText={setName} accessibilityLabel="Connection name" style={s.input} testID="setup-name" />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={s.label}>{d.url ? "Address" : "Runs in the sandbox"}</Text>
        <Mono>{d.url ?? [d.command, ...d.args].join(" ")}</Mono>
      </View>
      {canAddSpace ? (
        <View style={{ gap: 4 }}>
          <Text style={s.label}>Who can use it</Text>
          <View style={s.segs} accessibilityRole="radiogroup">
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: scope === "mine" }} onPress={() => setScope("mine")} style={[s.seg, scope === "mine" && s.segOn]} testID="scope-mine"><Text style={[s.segText, scope === "mine" && s.segTextOn]}>Me and my agents</Text></Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: scope === "space" }} onPress={() => setScope("space")} style={[s.seg, scope === "space" && s.segOn]} testID="scope-space"><Text style={[s.segText, scope === "space" && s.segTextOn]}>Everyone in the Space</Text></Pressable>
          </View>
        </View>
      ) : <Text style={s.quiet}>For you and your agents. Only you can see it.</Text>}
      {d.secrets.length > 0 ? <View style={s.result}><Glyph name="lock" /><Text style={s.quiet}>{`${d.secrets.map((x) => x.key).join(", ")} ${d.secrets.length === 1 ? "was" : "were"} in what you pasted. ${d.secrets.length === 1 ? "It goes" : "They go"} into your ${scope === "space" ? "Space's shared" : "own"} Vault folder, not into the command.`}</Text></View> : null}
      {fields}
      {pending.oauth ? <Text style={s.quiet}>This server signs in with your account. You can sign in once it is added.</Text> : null}
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={s.actions}>
        <Btn label="Skip" onPress={onSkip} testID="setup-skip" />
        <View style={{ flex: 1 }} />
        <Btn label={busy ? "Adding…" : "Add and check"} primary disabled={busy || name.trim() === "" || missing.length > 0} why={missing.length > 0 ? `Fill in ${missing.map((m) => m.key).join(", ")}` : undefined} onPress={() => { void add(); }} testID="setup-add" />
      </View>
    </View>
  );
}

function Done({ done, onClose, onMore }: { done: ReadonlyArray<{ title: string; added: Added }>; onClose(): void; onMore(): void }): ReactElement {
  const rows: ReactElement[] = [];
  for (const x of done) rows.push(<Row key={x.added.connectionId} id={`added-${x.added.connectionId}`} title={x.title} note={healthWords(x.added.health, x.added.tools)} leading={<View style={{ width: 20 }}><View style={[s.dot, { backgroundColor: dotColor(x.added.health) as string }]} /></View>} />);
  return (
    <View style={{ gap: 10 }} testID="connection-done-list">
      {rows}
      <View style={s.actions}><Btn label="Add another" onPress={onMore} /><View style={{ flex: 1 }} /><Btn label="Done" primary onPress={onClose} testID="connection-close" /></View>
    </View>
  );
}

/** The search field sits in its own filled box; the browser's focus ring would draw a second one inside it. */
const NO_RING = { outlineStyle: "none", outlineWidth: 0 } as unknown as TextStyle;

const s = StyleSheet.create({
  segs: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sel)" as string, alignSelf: "flex-start" },
  seg: { paddingHorizontal: 12, height: 26, justifyContent: "center", borderRadius: 6 },
  segOn: { backgroundColor: "var(--raised)" as string, boxShadow: "0 1px 2px rgba(0,0,0,0.12)" as string },
  segText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--sel)" as string },
  searchInput: { flex: 1, minWidth: 0, height: 30, color: "var(--ink)" as string, fontSize: 13.5, ...NO_RING },
  label: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  input: { minHeight: 32, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string, fontSize: 13 },
  area: { minHeight: 76, fontFamily: "var(--mono, ui-monospace, Menlo, monospace)" as string, fontSize: 12.5, textAlignVertical: "top" as const },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  result: { flexDirection: "row", alignItems: "center", gap: 8 },
  resultText: { fontSize: 14, fontWeight: "500", color: "var(--ink)" as string },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
