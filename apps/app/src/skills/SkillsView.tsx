// Skills (owner ruling 3 Nov): one page, the same parts in Settings > Skills (every Space, Personal and Team) and in Console > Skills (the admin's view). It takes `call` and nothing else from
// its surroundings, like the app hub card.
//   Settings: Waiting for you (cards for skills shared with you: Add, Not now, View), Mine (yours and the shared ones you added; on and off, which agents use it, share, update, remove),
//             From your Space (set by an admin for everyone; seen, never removed here), Built in, and Your agents (which skills each one uses, by the name it sees).
//   Console:  Space-wide skills (install, update, remove, keys), the scripts rule (off by default), members' skills by name with Make Space-wide on shared ones, Built in.
// Adding is one sheet: paste a link, drop a folder or zip, browse a marketplace, or ask the Assistant. What a skill can touch is shown before it is added and on every card.
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Dialog } from "../../../../ui/src/Dialog/index.tsx";
import { DropZone } from "../../../../ui/src/FileDrop/index.tsx";
import type { DroppedFile } from "../../../../ui/src/FileDrop/index.tsx";
import { Row } from "../../../../ui/src/Row/index.tsx";
import { TextField } from "../../../../ui/src/TextField/index.tsx";
import { Section, Segmented, SmallButton, Switch } from "../places/settings/ui.tsx";
import { cardLead, folderFiles, keyOf, oneLine, plainName, sharedLine, skillsOfAgent, sourceLine, titleOf, toBase64, touchLines, usedByLine } from "./model.ts";
import { checkServer, fileSkillKey } from "./actions.ts";
import type { Health } from "./actions.ts";
import type { Call, Card, MemberSkill, Own, Page, Perms, Preview, SpaceSkill } from "./model.ts";

export type Mode = "settings" | "console";
export type { Health };
const key = (): string => globalThis.crypto?.randomUUID?.() ?? `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const t = {
  lead: { fontSize: 12.5, color: "var(--ink-2)", lineHeight: 18 } as const,
  quiet: { fontSize: 12, color: "var(--ink-3)", lineHeight: 17 } as const,
  body: { fontSize: 13, color: "var(--ink)", lineHeight: 19 } as const,
  title: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" } as const,
  warn: { fontSize: 12.5, color: "var(--warning, var(--ink-2))", lineHeight: 18 } as const,
  mono: { fontSize: 12, color: "var(--ink-2)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 17 } as const,
};
const card = { padding: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" } as const;
const actions = { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 } as const;
/** In the Console a card's rows sit 10px from the card edge and 1px lines divide them. `index` is the row's place in its list. */
export const consoleLine = (index: number): { paddingVertical: number; borderTopWidth: number; borderTopColor: string } => ({ paddingVertical: 10, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: "var(--line)" });
// ui-rows-lint: not a list (a divider around rows that are each a ui/Row already)
const lined = (rows: readonly ReactElement[]): ReactElement[] => rows.map((r, i) => <View key={r.key ?? i} style={consoleLine(i)}>{r}</View>);
const quietText = (s: string): ReactElement => <Text style={t.quiet}>{s}</Text>;

/** What a skill can touch, as plain lines under a small heading. */
export function Touches({ perms, testID }: { perms: Perms; testID?: string }): ReactElement {
  return <View testID={testID} style={{ gap: 2 }}>
    <Text style={[t.quiet, { fontWeight: "600" }]}>What it can touch</Text>
    {/* ui-rows-lint: not a list (lines of one paragraph) */}
    {touchLines(perms).map((l) => <Text key={l} style={t.lead}>{l}</Text>)}
  </View>;
}

/** One card in Waiting for you: who shared it, what it does, what it can touch, where it came from; Add, Not now and View. */
export function ShareCard({ c, onAdd, onNotNow, onView, busy = false }: { c: Card; onAdd(): void; onNotNow(): void; onView(): void; busy?: boolean }): ReactElement {
  return <View style={card} testID={`skill-card-${c.name}`} accessibilityLabel={`${titleOf(c)}, shared by ${c.sharerName}`}>
    <Text style={c.growth.length > 0 ? t.warn : t.quiet}>{cardLead(c)}</Text>
    <Text style={t.title}>{titleOf(c)}</Text>
    <Text style={t.body}>{c.description}</Text>
    <Touches perms={c.perms} />
    {quietText(sourceLine(c))}
    <View style={actions}>
      <SmallButton primary label="Add to my skills" testID={`skill-card-add-${c.name}`} disabled={busy} onPress={onAdd} />
      <SmallButton label="Not now" testID={`skill-card-later-${c.name}`} disabled={busy} onPress={onNotNow} />
      <SmallButton label="View" testID={`skill-card-view-${c.name}`} onPress={onView} />
    </View>
  </View>;
}

export interface ListsProps {
  mode: Mode; page: Page; members?: readonly MemberSkill[]; nameOf(id: string): string; busy?: boolean;
  onCard(c: Card, decision: "add" | "not_now"): void; onView(target: { skillId?: string; name?: string }): void; onOpen(target: { kind: "mine" | "shared" | "space"; skillId: string }): void;
  onToggle(target: { kind: "mine" | "shared"; skillId: string } | { kind: "space"; name: string }, on: boolean): void; onAdd(): void; onAdopt(m: MemberSkill): void; onPolicy(on: boolean): void;
}

/** The add button of the page: quiet text, no frame until the pointer is over it, so it never competes with the lists. */
function GhostAdd({ label, onPress }: { label: string; onPress: () => void }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID="skill-add" onPress={onPress} style={({ hovered }: { hovered?: boolean }) => ({ height: 28, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center", backgroundColor: hovered ? "var(--hover)" : "transparent" }) as never}><Text style={{ fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string }}>{`+ ${label}`}</Text></Pressable>;
}

/** The lists of the page, drawn from skills.page. Pure: the static test renders it with a page and no server. */
export function SkillsLists(p: ListsProps): ReactElement {
  const { page, mode } = p;
  const added = page.shared.filter((c) => c.state === "added");
  const later = page.shared.filter((c) => c.state === "not_now");
  const addButton = <GhostAdd label={mode === "console" ? "Add a Space skill" : "Add a skill"} onPress={p.onAdd} />;
  const spaceRow = (s: SpaceSkill): ReactElement => <Row key={s.skillId} id={`skill-space-${s.name}`} title={titleOf(s)}
    note={`${s.description} · ${mode === "console" ? sourceLine(s) : "Set by an admin for everyone"}${s.needs.length > 0 ? ` · Needs ${s.needs.length === 1 ? "a key" : `${s.needs.length} keys`}` : ""}${s.enabled ? "" : " · Off"}`}
    onPress={() => p.onOpen({ kind: "space", skillId: s.skillId })}
    trailing={mode === "console" ? <Switch on={s.enabled} label={`${s.name} is on`} testID={`skill-space-on-${s.name}`} onChange={(on) => p.onToggle({ kind: "space", name: s.name }, on)} /> : quietText("For everyone")} />;
  const builtin = <Section title="Built in" testID="skills-builtin">
    {page.builtin.map((b) => <Row key={b.name} id={`skill-builtin-${b.name}`} title={plainName(b.name)} note={oneLine(b.description)} tall onPress={() => p.onView({ name: b.name })} trailing={quietText("Always on")} />)}
  </Section>;

  if (mode === "console") {
    const members = p.members ?? [];
    return <View testID="skills-console" style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 6 }}><Text style={[t.lead, { flex: 1 }]}>Space-wide skills apply to every member and their agents at once, with no card to approve.</Text></View>
      <Section title="Space-wide" testID="skills-space">
        {page.space.length > 0 ? lined(page.space.map(spaceRow)) : <View style={consoleLine(0)}><Row id="skills-space-none" title="No Space-wide skills yet" note="Add one, or make a member's shared skill Space-wide" /></View>}
      </Section>
      <Section title="Who may add skills that run code" testID="skills-policy" note="Off by default. Members approve their own skills and the ones shared with them either way.">
        <View style={consoleLine(0)}><Row id="skills-policy-scripts" title="Only admins add skills that run scripts or start tool servers" trailing={<Switch on={page.policy.scriptsAdminOnly} label="Only admins add skills that run scripts" testID="skills-policy-switch" onChange={p.onPolicy} />} /></View>
      </Section>
      <Section title="Members' skills" testID="skills-members" note="Names only. You can read a skill only when its owner shared it.">
        {members.length > 0 ? lined(members.map((m) => <Row key={`${m.owner}:${m.name}`} id={`skill-member-${m.owner}-${m.name}`} title={m.name} note={`${m.ownerName}${m.shared ? (m.toSpace ? " · Shared with everyone here" : " · Shared") : ""}`}
          {...(m.skillId ? { onPress: () => p.onView({ skillId: m.skillId! }) } : {})}
          trailing={m.shared ? <SmallButton label="Make Space-wide" testID={`skill-adopt-${m.name}`} disabled={p.busy === true} onPress={() => p.onAdopt(m)} /> : undefined} />))
          : <View style={consoleLine(0)}><Row id="skills-members-none" title="No member has a skill of their own yet" /></View>}
      </Section>
      {builtin}
    </View>;
  }

  const mineRow = (o: Own): ReactElement => {
    const shared = sharedLine(o.sharedWith, p.nameOf);
    return <Row key={o.skillId} id={`skill-mine-${o.name}`} title={titleOf(o)}
      note={`${o.description} · ${usedByLine(o.agents, page.agents)}${shared ? ` · ${shared}` : ""}${o.needs.length > 0 ? ` · Needs ${o.needs.length === 1 ? "a key" : `${o.needs.length} keys`}` : ""}`}
      onPress={() => p.onOpen({ kind: "mine", skillId: o.skillId })}
      trailing={<Switch on={o.enabled} label={`${o.name} is on`} testID={`skill-on-${o.name}`} onChange={(on) => p.onToggle({ kind: "mine", skillId: o.skillId }, on)} />} />;
  };
  const sharedRow = (c: Card): ReactElement => <Row key={c.skillId} id={`skill-shared-${c.name}`} title={titleOf(c)} note={`${c.description} · Shared by ${c.sharerName} · ${usedByLine(c.agents, page.agents)}`}
    onPress={() => p.onOpen({ kind: "shared", skillId: c.skillId })}
    trailing={<Switch on={c.enabled} label={`${c.name} is on`} testID={`skill-on-${c.name}`} onChange={(on) => p.onToggle({ kind: "shared", skillId: c.skillId }, on)} />} />;
  return <View testID="skills-settings" style={{ gap: 4 }}>
    {page.waiting.length > 0 ? <Section title="Waiting for you" testID="skills-waiting" note="A shared skill applies to you and your agents only after you add it.">
      {/* ui-rows-lint: not a list (approval cards with three buttons each) */}
      {page.waiting.map((c) => <ShareCard key={c.skillId} c={c} busy={p.busy === true} onAdd={() => p.onCard(c, "add")} onNotNow={() => p.onCard(c, "not_now")} onView={() => p.onView({ skillId: c.skillId })} />)}
    </Section> : null}
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}><Text style={[t.lead, { flex: 1 }]}>Skills are short instructions you and your agents load when they fit the work.</Text>{addButton}</View>
    <Section title="Mine" testID="skills-mine">
      {page.mine.length + added.length > 0 ? [...page.mine.map(mineRow), ...added.map(sharedRow)] : <Row id="skills-mine-none" title="No skills of your own yet" note="Paste a link, drop a folder or a zip, or ask the Assistant" />}
    </Section>
    {later.length > 0 ? <Section title="Not now" testID="skills-later">
      {later.map((c) => <Row key={c.skillId} id={`skill-later-${c.name}`} title={titleOf(c)} note={`Shared by ${c.sharerName}`} onPress={() => p.onView({ skillId: c.skillId })}
        trailing={<SmallButton label="Add" testID={`skill-later-add-${c.name}`} disabled={p.busy === true} onPress={() => p.onCard(c, "add")} />} />)}
    </Section> : null}
    {page.space.length > 0 ? <Section title="From your Space" testID="skills-space" note="An admin set these for everyone here. They apply to you and your agents.">
      {page.space.map(spaceRow)}
    </Section> : null}
    {builtin}
    {page.agents.length > 0 ? <Section title="Your agents" testID="skills-agents" note="The skills each agent uses, by the name it sees.">
      {page.agents.map((a) => { const names = skillsOfAgent(page, a.agentId); return <Row key={a.agentId} id={`skill-agent-${a.agentId}`} title={a.name} note={names.length > 0 ? names.join(", ") : "Built-in skills only"} />; })}
    </Section> : null}
  </View>;
}

// ---- the sheet of one skill ------------------------------------------------------------------------------------------------------------------------------

export interface DetailProps {
  mode: Mode; kind: "mine" | "shared" | "space"; skill: Own | Card | SpaceSkill; agents: readonly { agentId: string; name: string }[]; health: Readonly<Record<string, Health>>;
  people: readonly { id: string; name: string }[]; busy?: boolean; nameOf(id: string): string;
  onClose(): void; onAgents(agents: string[]): void; onShare(to: string[], space: boolean, stop: boolean): void; onKey(need: string, value: string): void; onTest(server: string): void;
  onUpdate(): void; onRemove(): void; onView(): void;
}

export function SkillSheet(p: DetailProps): ReactElement {
  const s = p.skill;
  const own = p.kind === "mine" ? (s as Own) : null;
  const agents = "agents" in s ? s.agents : ["*"];
  const [value, setValue] = useState<Record<string, string>>({});
  const [sharing, setSharing] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const canKeys = p.kind === "mine" || (p.kind === "space" && p.mode === "console");
  const canUpdate = (p.kind === "mine" || (p.kind === "space" && p.mode === "console")) && /^(link:|github:)/.test(s.source);
  const canRemove = p.kind !== "space" || p.mode === "console";
  const servers = s.perms.mcpServers;
  const toggleAgent = (id: string): void => {
    if (id === "*") { p.onAgents(agents.includes("*") ? [] : ["*"]); return; }
    const base = agents.includes("*") ? p.agents.map((a) => a.agentId) : agents;
    p.onAgents(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  };
  return <Dialog title={titleOf(s)} onClose={p.onClose} width={560} fill testID="skill-sheet" actions={[
    ...(canRemove ? [{ label: p.kind === "shared" ? "Take off my list" : "Remove", danger: true, disabled: p.busy === true, onPress: p.onRemove, testID: "skill-remove" }] : []),
    ...(canUpdate ? [{ label: "Update", disabled: p.busy === true, onPress: p.onUpdate, testID: "skill-update" }] : []),
    { label: "View contents", onPress: p.onView, testID: "skill-view" },
    { label: "Done", primary: true, onPress: p.onClose, testID: "skill-done" },
  ]}>
    <View style={{ gap: 12 }}>
      <Text style={t.body}>{s.description}</Text>
      {quietText(`${sourceLine(s)}${p.kind === "space" ? (p.mode === "console" ? " · Applies to everyone here" : " · Set by an admin for everyone; only an admin can remove it") : ""}${p.kind === "shared" ? ` · Shared by ${(s as Card).sharerName}` : ""}`)}
      <Touches perms={s.perms} testID="skill-touches" />
      {servers.length > 0 ? <View style={{ gap: 6 }} testID="skill-servers">
        <Text style={[t.quiet, { fontWeight: "600" }]}>Tool servers</Text>
        {/* ui-rows-lint: not a list (one block per server; its row is a ui/Row) */}
        {servers.map((m) => {
          const h = p.health[m.name];
          const missing = s.needs.filter((n) => keyOf(n).server === m.name);
          const state = missing.length > 0 ? `Needs ${missing.map((n) => keyOf(n).key).join(", ")}` : !h ? "Not checked yet" : h.state === "working" ? `Working · ${h.tools ?? 0} ${h.tools === 1 ? "tool" : "tools"}` : h.state === "checking" ? "Checking" : h.state === "needs" ? "Needs a key" : `Not answering${h.error ? `: ${h.error}` : ""}`;
          return <View key={m.name} style={{ gap: 6 }}>
            <Row id={`skill-server-${m.name}`} title={m.name} note={state} trailing={missing.length === 0 ? <SmallButton label="Test" testID={`skill-test-${m.name}`} disabled={p.busy === true || h?.state === "checking"} onPress={() => p.onTest(m.name)} /> : undefined} />
            {/* ui-rows-lint: not a list (key fields of a form) */}
            {canKeys ? missing.map((n) => <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12 }}>
              <Text style={[t.mono, { width: 150 }]}>{keyOf(n).key}</Text>
              <TextField secureTextEntry accessibilityLabel={`${keyOf(n).key} for ${m.name}`} testID={`skill-key-${n}`} value={value[n] ?? ""} onChangeText={(v) => setValue((was) => ({ ...was, [n]: v }))} placeholder="Paste the key" style={{ flex: 1, minWidth: 0 }} />
              <SmallButton primary label="Add to Vault" testID={`skill-vault-${n}`} disabled={p.busy === true || (value[n] ?? "").trim() === ""} onPress={() => { p.onKey(n, value[n]!.trim()); setValue((was) => ({ ...was, [n]: "" })); }} />
            </View>) : missing.length > 0 && p.kind === "shared" ? <Text style={[t.quiet, { paddingLeft: 12 }]}>{`${(s as Card).sharerName} sets its keys.`}</Text> : null}
          </View>;
        })}
      </View> : null}
      {p.kind !== "space" ? <View style={{ gap: 2 }} testID="skill-used-by">
        <Text style={[t.quiet, { fontWeight: "600" }]}>Used by</Text>
        <Row id="skill-agents-all" title="All my agents" trailing={<Switch on={agents.includes("*")} label="All my agents" testID="skill-agents-all" onChange={() => toggleAgent("*")} />} />
        {p.agents.map((a) => <Row key={a.agentId} id={`skill-agent-pick-${a.agentId}`} title={a.name} trailing={<Switch on={agents.includes("*") || agents.includes(a.agentId)} label={`${a.name} uses it`} testID={`skill-agent-${a.agentId}`} onChange={() => toggleAgent(a.agentId)} />} />)}
      </View> : null}
      {own ? <View style={{ gap: 6 }} testID="skill-sharing">
        <Text style={[t.quiet, { fontWeight: "600" }]}>Sharing</Text>
        {quietText(sharedLine(own.sharedWith, p.nameOf) ?? "Only you")}
        {sharing ? <View style={{ gap: 4 }}>
          {p.people.map((x) => <Row key={x.id} id={`skill-share-${x.id}`} title={x.name} trailing={<Switch on={pick.includes(x.id) || own.sharedWith.includes(x.id)} label={`Share with ${x.name}`} testID={`skill-share-${x.id}`} onChange={(on) => { if (own.sharedWith.includes(x.id)) p.onShare([x.id], false, true); else setPick((was) => (on ? [...was, x.id] : was.filter((y) => y !== x.id))); }} />} />)}
          <View style={actions}>
            <SmallButton primary label={pick.length > 0 ? `Share with ${pick.length === 1 ? "1 person" : `${pick.length} people`}` : "Share"} testID="skill-share-people" disabled={p.busy === true || pick.length === 0} onPress={() => { p.onShare(pick, false, false); setPick([]); setSharing(false); }} />
            {own.sharedWith.includes("*") ? <SmallButton label="Stop sharing with everyone" testID="skill-unshare-space" onPress={() => p.onShare([], true, true)} />
              : <SmallButton label="Share with everyone here" testID="skill-share-space" disabled={p.busy === true} onPress={() => { p.onShare([], true, false); setSharing(false); }} />}
          </View>
          {quietText("Each person gets a card and decides. It never applies to them before they add it.")}
        </View> : <View style={actions}><SmallButton label="Share" testID="skill-share" onPress={() => setSharing(true)} /></View>}
      </View> : null}
    </View>
  </Dialog>;
}

// ---- adding ----------------------------------------------------------------------------------------------------------------------------------------------

type Way = "link" | "drop" | "browse" | "ask";
export interface BrowseRow { marketplaceId: string; marketplace: string; name: string; description?: string; version?: string; allowed: boolean }

export interface AddProps {
  mode: Mode; busy?: boolean; error?: string | null; found: { skills: Preview[]; problems: string[]; skipped: string[] } | null; browse: readonly BrowseRow[]; canAsk: boolean; initialWay?: Way;
  onClose(): void; onLink(link: string): void; onZip(name: string, b64: string): void; onFolder(files: Record<string, string>, hint: string): void; onBrowse(row: BrowseRow): void; onAsk(link: string): void;
  onAdd(picked: Preview[]): void; onBack(): void;
}

/** The Add a skill sheet: four ways in, then one review of what was found and what each skill can touch, then Add. */
export function AddSheet(p: AddProps): ReactElement {
  const [way, setWay] = useState<Way>(p.initialWay ?? "link");
  const [link, setLink] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null);
  const zipInput = useRef<{ click(): void } | null>(null);
  const dirInput = useRef<{ click(): void } | null>(null);
  const takeFiles = useCallback(async (files: DroppedFile[]): Promise<void> => {
    const f = files[0];
    if (!f?.arrayBuffer) return;
    const buf = await f.arrayBuffer();
    if (/\.zip$/i.test(f.name)) p.onZip(f.name, toBase64(buf));
    else p.onFolder({ [/^agents\.md$/i.test(f.name) ? "AGENTS.md" : "SKILL.md"]: new TextDecoder().decode(buf) }, f.name.replace(/\.(md|markdown)$/i, ""));
  }, [p]);
  if (p.found) {
    const chosen = picked ?? p.found.skills.map((s) => s.path);
    const list = p.found.skills.filter((s) => chosen.includes(s.path));
    return <Dialog title={p.found.skills.length === 1 ? "Add this skill?" : `${p.found.skills.length} skills found`} onClose={p.onClose} width={560} fill testID="skill-review" actions={[
      { label: "Back", onPress: p.onBack, testID: "skill-review-back" },
      { label: p.mode === "console" ? "Add for everyone" : list.length > 1 ? `Add ${list.length} skills` : "Add to my skills", primary: true, disabled: p.busy === true || list.length === 0, onPress: () => p.onAdd(list), testID: "skill-review-add" },
    ]}>
      <View style={{ gap: 12 }}>
        {/* ui-rows-lint: not a list (review blocks; each holds a ui/Row) */}
        {p.found.skills.map((s) => <View key={s.path || s.name} style={{ gap: 6, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" }} testID={`skill-found-${s.name}`}>
          <Row id={`skill-found-row-${s.name}`} title={s.taken ?? s.name} note={`${s.description}${s.kind === "codex" ? " · Codex skill" : s.kind === "plugin" ? " · From a plugin" : ""}`}
            trailing={p.found!.skills.length > 1 ? <Switch on={chosen.includes(s.path)} label={`Add ${s.name}`} testID={`skill-found-pick-${s.name}`} onChange={(on) => setPicked(on ? [...chosen, s.path] : chosen.filter((x) => x !== s.path))} /> : undefined} />
          {s.taken ? <Text style={t.quiet}>{`You already have a skill called ${s.name}. This one will be ${s.taken}.`}</Text> : null}
          <Touches perms={s.perms} />
          {quietText(`${Object.keys(s.files).length} ${Object.keys(s.files).length === 1 ? "file" : "files"} beside its SKILL.md${s.version ? ` · version ${s.version}` : ""}`)}
        </View>)}
        {/* ui-rows-lint: not a list (lines of text) */}
        {p.found.problems.map((x) => <Text key={x} style={t.warn}>{x}</Text>)}
        {p.found.skipped.length > 0 ? quietText(`Left out (not text): ${p.found.skipped.slice(0, 5).join(", ")}${p.found.skipped.length > 5 ? ` and ${p.found.skipped.length - 5} more` : ""}`) : null}
        {quietText(p.mode === "console" ? "A Space-wide skill applies to every member and their agents at once." : "It is for you and all your agents. You can pick agents after.")}
      </View>
    </Dialog>;
  }
  const ways = [{ value: "link", label: "Paste a link" }, { value: "drop", label: "Folder or zip" }, { value: "browse", label: "Marketplace" }, ...(p.canAsk ? [{ value: "ask", label: "Ask the Assistant" }] : [])];
  const allowed = p.browse.filter((b) => b.allowed);
  return <Dialog title={p.mode === "console" ? "Add a Space skill" : "Add a skill"} onClose={p.onClose} width={560} fill testID="skill-add-sheet" actions={[
    // a pasted SKILL.md (front matter or a heading, more than one line) is read as the file itself; anything else is a link
    ...(way === "link" ? [{ label: "Read it", primary: true, disabled: p.busy === true || link.trim() === "", onPress: () => (/^(---|#)/.test(link.trim()) && link.trim().includes("\n") ? p.onFolder({ "SKILL.md": link.trim() + "\n" }, "skill") : p.onLink(link.trim())), testID: "skill-link-read" }] : []),
    ...(way === "ask" ? [{ label: "Ask the Assistant", primary: true, disabled: link.trim() === "", onPress: () => p.onAsk(link.trim()), testID: "skill-ask-go" }] : []),
    { label: "Cancel", onPress: p.onClose, testID: "skill-add-cancel" },
  ]}>
    <View style={{ gap: 12 }}>
      <Segmented value={way} options={ways} label="How to add it" testID="skill-add-way" onChange={(v) => setWay(v as Way)} />
      {way === "link" || way === "ask" ? <View style={{ gap: 6 }}>
        <TextField accessibilityLabel="Link" testID="skill-link" value={link} onChangeText={setLink} placeholder="https://github.com/anthropics/skills/tree/main/pdf" autoCapitalize="none" multiline={way === "link"} style={way === "link" ? { minHeight: 38, maxHeight: 160 } : undefined} />
        {quietText(way === "ask" ? "The Assistant reads it beside this page, shows what it can touch, and adds it on your yes." : "A link to a SKILL.md, a GitHub repo or a folder in one, or paste the SKILL.md itself. Codex skill folders work too.")}
      </View> : null}
      {way === "drop" ? <View style={{ gap: 8 }}>
        <DropZone onFiles={(f) => void takeFiles(f)} label="Drop to read it" style={{ minHeight: 120, borderWidth: 1, borderStyle: "dashed", borderColor: "var(--line)", borderRadius: 10, alignItems: "center", justifyContent: "center", display: "flex" }} testID="skill-drop">
          <Text style={t.lead}>Drop a zip, a SKILL.md or an AGENTS.md here</Text>
        </DropZone>
        {Platform.OS === "web" ? createElement("input", { type: "file", accept: ".zip,.md,.markdown", "aria-label": "Choose a zip", "data-testid": "skill-zip-input", ref: zipInput, style: { display: "none" },
          onChange: (e: { target: { files?: FileList | null; value: string } }) => { const f = e.target.files?.[0]; if (f) void takeFiles([{ name: f.name, arrayBuffer: () => f.arrayBuffer() }]); e.target.value = ""; } }) : null}
        {Platform.OS === "web" ? createElement("input", { type: "file", webkitdirectory: "", directory: "", multiple: true, "aria-label": "Choose a folder", "data-testid": "skill-dir-input", ref: dirInput, style: { display: "none" },
          onChange: (e: { target: { files?: FileList | null; value: string } }) => { const fs = e.target.files; if (fs && fs.length > 0) void folderFiles(Array.from(fs) as never).then((r) => p.onFolder(r.files, r.hint)); e.target.value = ""; } }) : null}
        <View style={actions}><SmallButton label="Choose a zip or file" testID="skill-pick-zip" onPress={() => zipInput.current?.click()} /><SmallButton label="Choose a folder" testID="skill-pick-folder" onPress={() => dirInput.current?.click()} /></View>
      </View> : null}
      {way === "browse" ? <View testID="skill-browse">
        {allowed.length > 0 ? allowed.map((b) => <Row key={`${b.marketplaceId}:${b.name}`} id={`skill-browse-${b.name}`} title={b.name} note={`${b.description ?? ""}${b.description ? " · " : ""}${b.marketplace}${b.version ? ` · ${b.version}` : ""}`} onPress={() => p.onBrowse(b)} />)
          : <Row id="skill-browse-none" title="No marketplace is allowed here yet" note={p.mode === "console" ? "Add one in Console, Plugins and tools" : "An admin adds one in Console"} />}
      </View> : null}
      {p.error ? <Text style={t.warn} testID="skill-add-error">{p.error}</Text> : null}
    </View>
  </Dialog>;
}

// ---- the page, wired to the server ----------------------------------------------------------------------------------------------------------------------

export interface SkillsPageProps {
  call: Call; mode: Mode;
  /** Opens the Ask pane beside the page with a first message (Ask the Assistant to install it). Absent where the shell has no assistant. */
  ask?: (draft: string) => void;
  /** Open the page with the Add sheet up (the screenshots and a deep link). */
  initialAdd?: boolean;
  /** Console: a count the page above raises to open the Add sheet (its "Add a Space skill" button lives in the Installed for the Space header). */
  addTick?: number;
}

const msg = (e: unknown): string => { const x = e as { message?: string; error?: { message?: string } }; return x.error?.message ?? x.message ?? "That did not work."; };

export function SkillsPage({ call, mode, ask, initialAdd = false, addTick = 0 }: SkillsPageProps): ReactElement {
  const [page, setPage] = useState<Page | null>(null);
  const [members, setMembers] = useState<MemberSkill[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ kind: "mine" | "shared" | "space"; skillId: string } | null>(null);
  const [viewing, setViewing] = useState<{ name: string; text: string; files: { path: string; bytes: number }[] } | null>(null);
  const [adding, setAdding] = useState(initialAdd);
  useEffect(() => { if (addTick > 0) { setAdding(true); setFound(null); setAddError(null); } }, [addTick]);
  const [found, setFound] = useState<AddProps["found"]>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [browse, setBrowse] = useState<BrowseRow[]>([]);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const load = useCallback(async (): Promise<void> => {
    try {
      setPage((await call("skills.page", {})) as Page);
      if (mode === "console") setMembers(((await call("skills.members", {})) as { skills: MemberSkill[] }).skills);
      setError(null);
    } catch (e) { setError(msg(e)); }
  }, [call, mode]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void call("access.principals.list", { kind: "person", status: "active" }).then((o) => setPeople(((o as { principals?: { id: string; name: string }[] }).principals ?? []).map((x) => ({ id: x.id, name: x.name }))), () => undefined);
  }, [call]);
  useEffect(() => {
    if (!adding) return;
    void call("plugins.browse", {}).then((o) => setBrowse((o as { plugins?: BrowseRow[] }).plugins ?? []), () => undefined);
  }, [adding, call]);
  const run = async <T,>(f: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try { const out = await f(); await load(); return out; } catch (e) { setError(msg(e)); return undefined; } finally { setBusy(false); }
  };
  const nameOf = (id: string): string => people.find((x) => x.id === id)?.name ?? id;
  if (!page) return <View testID="skills-loading" style={{ padding: 14 }}><Text style={t.quiet}>{error ?? "Loading skills"}</Text></View>;

  const target = open ? (open.kind === "mine" ? page.mine.find((m) => m.skillId === open.skillId) : open.kind === "shared" ? [...page.shared, ...page.waiting].find((c) => c.skillId === open.skillId) : page.space.find((s) => s.skillId === open.skillId)) : undefined;
  const preview = async (input: Record<string, unknown>): Promise<void> => {
    setBusy(true); setAddError(null);
    try { setFound((await call("skills.preview", input)) as NonNullable<AddProps["found"]>); } catch (e) { setAddError(msg(e)); } finally { setBusy(false); }
  };
  const addPicked = async (list: Preview[]): Promise<void> => {
    setBusy(true); setAddError(null);
    let last: Own | null = null;
    try {
      for (const s of list) {
        if (mode === "console") await call("skills.space.install", { text: s.text, files: s.files, source: s.source, ...(s.version ? { version: s.version } : {}), idempotencyKey: key() });
        else last = ((await call("skills.mine.add", { text: s.text, files: s.files, source: s.source, ...(s.version ? { version: s.version } : {}), idempotencyKey: key() })) as { skill: Own }).skill;
      }
      setAdding(false); setFound(null);
      await load();
      // a skill whose servers want keys opens on its setup, so the keys go through the Vault before anything runs
      if (last && last.needs.length > 0) setOpen({ kind: "mine", skillId: last.skillId });
    } catch (e) { setAddError(msg(e)); } finally { setBusy(false); }
  };
  const putKey = async (s: Own | SpaceSkill, need: string, value: string): Promise<void> => {
    const ok = await run(() => fileSkillKey(call, { skill: s.name, skillId: s.skillId, need, value, space: open?.kind === "space" }));
    if (ok) void test(s, keyOf(need).server);
  };
  const test = async (s: Own | Card | SpaceSkill, server: string): Promise<void> => {
    const agentId = page.agents.find((a) => !("agents" in s) || s.agents.includes("*") || s.agents.includes(a.agentId))?.agentId ?? page.agents[0]?.agentId;
    setHealth((h) => ({ ...h, [server]: { state: "checking" } }));
    const r = await checkServer(call, { skillId: s.skillId, server, agentId });
    setHealth((h) => ({ ...h, [server]: r }));
  };
  const view = async (q: { skillId?: string; name?: string }): Promise<void> => {
    try { const v = ((await call("skills.view", q)) as { skill: { name: string; text: string; files: { path: string; bytes: number }[] } }).skill; setViewing(v); } catch (e) { setError(msg(e)); }
  };

  return <View testID={mode === "console" ? "console-skills" : "settings-skills"}>
    {error ? <Text style={[t.warn, { marginBottom: 8 }]} testID="skills-error" accessibilityRole="alert">{error}</Text> : null}
    <SkillsLists mode={mode} page={page} members={members} nameOf={nameOf} busy={busy}
      onCard={(c, decision) => void run(() => call("skills.shared.decide", { skillId: c.skillId, decision, idempotencyKey: key() }))}
      onView={(q) => void view(q)} onOpen={setOpen} onAdd={() => { setAdding(true); setFound(null); setAddError(null); }}
      onToggle={(x, on) => void run(() => (x.kind === "space" ? call("skills.set_enabled", { name: x.name, enabled: on, idempotencyKey: key() }) : call("skills.mine.set", { skillId: x.skillId, enabled: on, idempotencyKey: key() })))}
      onAdopt={(m) => void run(() => call("skills.space.adopt", { skillId: m.skillId, idempotencyKey: key() }))}
      onPolicy={(on) => void run(() => call("skills.policy.set", { scriptsAdminOnly: on, idempotencyKey: key() }))} />
    {open && target ? <SkillSheet mode={mode} kind={open.kind} skill={target} agents={page.agents} health={health} people={people.filter((x) => x.id !== page.me)} busy={busy} nameOf={nameOf}
      onClose={() => setOpen(null)} onView={() => void view(open.kind === "space" ? { skillId: open.skillId } : { skillId: open.skillId })}
      onAgents={(agents) => void run(() => call("skills.mine.set", { skillId: open.skillId, agents, idempotencyKey: key() }))}
      onShare={(to, space, stop) => void run(() => call("skills.share", { skillId: open.skillId, ...(to.length > 0 ? { to } : {}), ...(space ? { space: true } : {}), ...(stop ? { stop: true } : {}), idempotencyKey: key() }))}
      onKey={(need, value) => void putKey(target as Own | SpaceSkill, need, value)} onTest={(server) => void test(target, server)}
      onUpdate={() => void run(() => (open.kind === "space" ? call("skills.space.update", { name: target.name, idempotencyKey: key() }) : call("skills.mine.update", { skillId: open.skillId, idempotencyKey: key() })))}
      onRemove={() => void run(async () => { if (open.kind === "space") await call("skills.remove", { name: target.name, idempotencyKey: key() }); else await call("skills.mine.remove", { skillId: open.skillId, idempotencyKey: key() }); setOpen(null); })} /> : null}
    {adding ? <AddSheet mode={mode} busy={busy} error={addError} found={found} browse={browse} canAsk={mode === "settings" && ask !== undefined}
      onClose={() => { setAdding(false); setFound(null); }} onBack={() => setFound(null)}
      onLink={(link) => void preview({ link })} onZip={(name, zip) => void preview({ zip, hint: name.replace(/\.zip$/i, "") })} onFolder={(files, hint) => void preview({ files, hint })}
      onBrowse={(b) => void preview({ marketplace: { marketplaceId: b.marketplaceId, plugin: b.name } })}
      onAsk={(link) => { setAdding(false); ask?.(`Install this skill for me: ${link}`); }} onAdd={(list) => void addPicked(list)} /> : null}
    {viewing ? <Dialog title={viewing.name} onClose={() => setViewing(null)} width={640} fill testID="skill-contents" actions={[{ label: "Close", primary: true, onPress: () => setViewing(null) }]}>
      <View style={{ gap: 10 }}>
        <Text style={t.mono} selectable>{viewing.text}</Text>
        {viewing.files.length > 0 ? quietText(`Files: ${viewing.files.map((f) => f.path).join(", ")}`) : null}
      </View>
    </Dialog> : null}
  </View>;
}
