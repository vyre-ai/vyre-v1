// Console, AI, Internet access: what AI tools can reach on the internet (owner ruling 3 Nov). The setting engine.egress, saved with settings.set_space, which needs policy.manage (owners and admins)
// and writes an audit row. It applies from the next engine start on the Space's servers and on members' computers for this Space; agents' refused hosts show in the audit log.
import { useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Actions, Button, Field, Help, Note, ReadState, useAction, useRead } from "./shared.tsx";
import { Choice } from "./ai-controls.tsx";
import { INTERNET_CHOICES, internetPolicy, internetSummary, parseHosts } from "./internet-values.ts";
import type { InternetMode, InternetPolicy } from "./internet-values.ts";

const KEY = "engine.egress";

export function InternetAccess(): ReactElement {
  const setting = useRead<CapMap["settings.get"]["out"]>("settings.get", { key: KEY });
  if (!setting.data) return <ReadState error={setting.error} retry={setting.refresh} />;
  const saved = internetPolicy(setting.data.row.value);
  return <InternetEditor key={JSON.stringify(saved)} saved={saved} refresh={setting.refresh} />;
}

function InternetEditor({ saved, refresh }: { saved: InternetPolicy; refresh(): void }): ReactElement {
  const [mode, setMode] = useState<InternetMode>(saved.mode);
  const [text, setText] = useState(saved.hosts.join("\n"));
  const [review, setReview] = useState<InternetPolicy | null>(null);
  const [error, setError] = useState("");
  const action = useAction(refresh);
  const draft = (): InternetPolicy | null => {
    if (mode !== "list") return { mode, hosts: saved.hosts };
    const parsed = parseHosts(text);
    if (parsed.bad.length > 0) { setError(`Not a host name: ${parsed.bad.slice(0, 3).join(", ")}`); return null; }
    return { mode, hosts: parsed.hosts };
  };
  return <>
    <Section title="What AI tools can reach on the internet"><Group>
      <Help>Applies to Claude Code, Codex and Grok when they start, on this Space's servers and on members' computers working for this Space. Files stay confined either way.</Help>
      <Choice label="Internet access" value={mode} options={INTERNET_CHOICES} onChange={(value) => { setMode(value as InternetMode); setReview(null); setError(""); }} />
      {mode === "list" ? <Field label="Hosts AI tools may reach (one per line, *.example.com for every name under it)" value={text} multiline testID="internet-hosts" onChange={(value) => { setText(value); setReview(null); setError(""); }} /> : null}
    </Group></Section>
    {error ? <Note>{error}</Note> : null}
    {review ? <Section title="Review change"><Group>
      <Row title={INTERNET_CHOICES.find((c) => c.key === review.mode)?.title ?? review.mode} note={internetSummary(review)} />
      <Actions>
        <Button label="Back to editing" onPress={() => setReview(null)} />
        <Button label="Apply" testID="internet-apply" disabled={action.busy} onPress={() => void action.run("settings.set_space", { key: KEY, value: review }, "Internet access saved").then((out) => { if (out) setReview(null); })} />
      </Actions>
    </Group></Section> : <Actions><Button label="Review change" testID="internet-review" onPress={() => { const d = draft(); if (d) setReview(d); }} /></Actions>}
    {action.note ? <Note>{action.note}</Note> : null}
  </>;
}
