// Skills (CHAT-DESIGN ruling 4): the Space library of SKILL.md files an agent can load, beside the ones Vyre ships. An admin pastes a skill or uploads a .md file; a skill can be switched off
// without being removed. An agent's own skills/ folder and the skills a plugin brings show here too, named for where they come from.
import { createElement, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Empty, Group, Section } from "../shell/ui.tsx";
import { Help,  Actions, Button, FormSheet, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";
import { Tick } from "./ai-controls.tsx";

type Skills = CapMap["skills.list"]["out"];
type Skill = Skills["skills"][number];

const TEMPLATE = "---\nname: my-skill\ndescription: What this skill does and when to use it.\n---\n\nThe steps, in plain words.\n";
export const sourceLabel = (s: Skill): string => (s.tier === "builtin" ? "Vyre" : s.source.startsWith("plugin:") ? `Plugin ${s.source.slice(7)}` : s.source.startsWith("kit:") ? `Kit ${s.source.slice(4)}` : s.tier === "agent" ? "One agent" : "Added by an admin");

/** A button that opens the file picker and hands back the text of the chosen file. The plain input stays out of sight, so the page keeps its own buttons. */
function PickFile({ label, onText }: { label: string; onText(text: string, name: string): void }): ReactElement {
  const input = useRef<{ click(): void } | null>(null);
  return <View>
    {createElement("input", {
      type: "file", accept: ".md,.markdown,text/markdown,text/plain", "aria-label": `${label} (file)`, "data-testid": "skill-upload", ref: input, style: { display: "none" },
      onChange: (e: { target: { files?: FileList | null; value: string } }) => {
        const f = e.target.files?.[0];
        if (!f) return;
        void f.text().then((t) => onText(t, f.name));
        e.target.value = "";
      },
    })}
    <Button label={label} testID="skill-pick" onPress={() => input.current?.click()} />
  </View>;
}

/** The SKILL.md box: tall enough to read a skill, set in a fixed-width face so the front matter lines up. */
function SkillBox({ value, onChange }: { value: string; onChange(v: string): void }): ReactElement {
  return <View style={{ gap: 6, marginVertical: 8 }}>
    <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>SKILL.md</Text>
    <TextInput multiline accessibilityLabel="SKILL.md" testID="skill-text" value={value} onChangeText={onChange} placeholder={"---\nname: my-skill\ndescription: What it does and when to use it\n---\n\nThe steps."} placeholderTextColor="var(--ink-4)"
      style={{ minHeight: 180, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 8, padding: 10, fontSize: 12.5, lineHeight: 18, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--ink)" as string, backgroundColor: "var(--raised)" as string }} />
  </View>;
}

export function SkillsPage(): ReactElement {
  const list = useRead<Skills>("skills.list", { includeOff: true });
  const [text, setText] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const mine = list.data.skills.filter((s) => s.tier !== "builtin");
  const shipped = list.data.skills.filter((s) => s.tier === "builtin");
  const add = (): void => { void action.run("skills.add", { text, idempotencyKey: attempt() }, (out: { skill: { name: string } }) => `${out.skill.name} added`).then((out) => { if (out) setText(""); }); };
  const row = (s: Skill): ReactElement => {
    const key = `${s.tier}:${s.agentId ?? ""}:${s.name}`;
    const removable = s.tier !== "builtin";
    return <Row key={key} id={`skill-${s.name}`} title={s.name} note={`${s.description} · ${sourceLabel(s)}${s.enabled ? "" : " · Off"}`} onPress={() => setOpen(open === key ? null : key)}
      trailing={removable ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{s.enabled ? "On" : "Off"}</Text><Tick label={`${s.name} is on`} checked={s.enabled} disabled={action.busy} onChange={(on) => void action.run("skills.set_enabled", { name: s.name, ...(s.agentId ? { agentId: s.agentId } : {}), enabled: on, idempotencyKey: attempt() }, on ? "Skill on" : "Skill off")} /></View> : <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>Always on</Text>} />;
  };
  return <View testID="console-skills">
    <Section title="Your skills" count={mine.length} right={<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Help>Short instructions an agent loads when they fit the work.</Help><Button label="Add a skill" testID="skill-new" onPress={() => setAdding(true)} /></View>}><Group>
      {mine.length === 0 ? <Empty testID="skills-none" icon="assistant" action={{ label: "Add a skill", onPress: () => setAdding(true) }}>No skills yet</Empty> : mine.map(row)}
    </Group></Section>
    {open && mine.some((s) => `${s.tier}:${s.agentId ?? ""}:${s.name}` === open) ? (() => {
      const s = mine.find((x) => `${x.tier}:${x.agentId ?? ""}:${x.name}` === open)!;
      return <Section title={s.name}><Group><Note>{s.description}</Note><Actions><Button label="Remove skill" danger testID="skill-remove" disabled={action.busy} onPress={() => void action.run("skills.remove", { name: s.name, ...(s.agentId ? { agentId: s.agentId } : {}), idempotencyKey: attempt() }, "Skill removed").then(() => setOpen(null))} /></Actions></Group></Section>;
    })() : null}
    {adding ? <FormSheet title="Add a skill" testID="skill-sheet" onClose={() => setAdding(false)} submit="Add skill" disabled={action.busy || text.trim() === ""} why={text.trim() === "" ? "Add the skill text" : undefined} onSubmit={() => { add(); setAdding(false); }}>
      <Help>Paste a SKILL.md or choose the file.</Help>
      <SkillBox value={text} onChange={setText} />
      <Actions><Button label="Use the template" onPress={() => setText(TEMPLATE)} /><PickFile label="Upload a SKILL.md" onText={(t) => setText(t)} /></Actions>
    </FormSheet> : null}
    <Section title="Built in to Vyre" count={shipped.length}><Group>{shipped.length ? shipped.map(row) : <Empty icon="assistant">Nothing built in</Empty>}</Group></Section>
    {action.note ? <Text accessibilityRole="status" style={{ fontSize: 12, color: "var(--ink-3)" as string, marginTop: 8 }}>{action.note}</Text> : null}
  </View>;
}
