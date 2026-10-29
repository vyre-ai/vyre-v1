// Skills (CHAT-DESIGN ruling 4): the Space library of SKILL.md files an agent can load, beside the ones Vyre ships. An admin pastes a skill or uploads a .md file; a skill can be switched off
// without being removed. An agent's own skills/ folder and the skills a plugin brings show here too, named for where they come from.
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";
import { Tick } from "./ai-controls.tsx";

type Skills = CapMap["skills.list"]["out"];
type Skill = Skills["skills"][number];

const TEMPLATE = "---\nname: my-skill\ndescription: What this skill does and when to use it.\n---\n\nThe steps, in plain words.\n";
export const sourceLabel = (s: Skill): string => (s.tier === "builtin" ? "Vyre" : s.source.startsWith("plugin:") ? `Plugin ${s.source.slice(7)}` : s.source.startsWith("kit:") ? `Kit ${s.source.slice(4)}` : s.tier === "agent" ? "One agent" : "Added by an admin");

/** A file picker that hands back the text of the chosen file. Plain input on the web, where this Console runs. */
function PickFile({ label, onText }: { label: string; onText(text: string, name: string): void }): ReactElement {
  return <View accessibilityLabel={label}>{createElement("input", {
    type: "file", accept: ".md,.markdown,text/markdown,text/plain", "aria-label": label, "data-testid": "skill-upload",
    onChange: (e: { target: { files?: FileList | null; value: string } }) => {
      const f = e.target.files?.[0];
      if (!f) return;
      void f.text().then((t) => onText(t, f.name));
      e.target.value = "";
    },
    style: { fontSize: 13, color: "var(--ink-2)" },
  })}</View>;
}

export function SkillsPage(): ReactElement {
  const list = useRead<Skills>("skills.list", { includeOff: true });
  const [text, setText] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const mine = list.data.skills.filter((s) => s.tier !== "builtin");
  const shipped = list.data.skills.filter((s) => s.tier === "builtin");
  const add = (): void => { void action.run("skills.add", { text, idempotencyKey: attempt() }, (out: { skill: { name: string } }) => `${out.skill.name} added`).then((out) => { if (out) setText(""); }); };
  const row = (s: Skill): ReactElement => {
    const key = `${s.tier}:${s.agentId ?? ""}:${s.name}`;
    const removable = s.tier !== "builtin";
    return <Row key={key} id={`skill-${s.name}`} title={s.name} note={`${s.description} · ${sourceLabel(s)}${s.enabled ? "" : " · Off"}`} onPress={() => setOpen(open === key ? null : key)}
      trailing={removable ? <Tick label={`${s.name} is on`} checked={s.enabled} disabled={action.busy} onChange={(on) => void action.run("skills.set_enabled", { name: s.name, ...(s.agentId ? { agentId: s.agentId } : {}), enabled: on, idempotencyKey: attempt() }, on ? "Skill on" : "Skill off")} /> : undefined} />;
  };
  return <View testID="console-skills">
    <Note>A skill is a short set of instructions an agent loads when it fits the work. Each chat shows the agent the list, one line each, and the agent opens the one it needs.</Note>
    <Section title="Your skills" count={mine.length}><Group>
      {mine.length === 0 ? <Row id="skills-none" title="No skills of your own yet" note="Add one below, or install a plugin or a Kit that brings some." /> : mine.map(row)}
    </Group></Section>
    {open && mine.some((s) => `${s.tier}:${s.agentId ?? ""}:${s.name}` === open) ? (() => {
      const s = mine.find((x) => `${x.tier}:${x.agentId ?? ""}:${x.name}` === open)!;
      return <Section title={s.name}><Group><Note>{s.description}</Note><Actions><Button label="Remove skill" danger testID="skill-remove" disabled={action.busy} onPress={() => void action.run("skills.remove", { name: s.name, ...(s.agentId ? { agentId: s.agentId } : {}), idempotencyKey: attempt() }, "Skill removed").then(() => setOpen(null))} /></Actions></Group></Section>;
    })() : null}
    <Section title="Add a skill"><Group>
      <Note>Paste a SKILL.md, or choose the file. It starts with a name and a description between two --- lines, then the instructions.</Note>
      <Field label="SKILL.md" testID="skill-text" value={text} onChange={setText} multiline />
      <Actions>
        <Button label="Use the template" onPress={() => setText(TEMPLATE)} />
        <PickFile label="Upload a SKILL.md" onText={(t) => setText(t)} />
        <Button label="Add skill" testID="skill-add" disabled={action.busy || text.trim() === ""} onPress={add} />
      </Actions>
    </Group></Section>
    <Section title="Built in to Vyre" count={shipped.length}><Group>{shipped.map(row)}</Group></Section>
    {action.note ? <Text accessibilityRole="status" style={{ fontSize: 12, color: "var(--ink-3)" as string, marginTop: 8 }}>{action.note}</Text> : null}
  </View>;
}
