// The form for a step that has one of its own. Each kind loads only the lists it picks from, so a panel for any other step asks for nothing.
import type { ReactElement } from "react";
import { useOptionalAutomationsData } from "../data.tsx";
import type { DefNode, Definition, KeyChoice } from "../model.ts";
import { AiForm, CodeForm, HttpForm } from "./StepForms.tsx";
import type { OpenMenu } from "./StepForms.tsx";
import { useAgentPicks, useVaultPicks, useWhoPicks } from "./useLists.ts";

interface Props { def: Definition; node: DefNode; onChange(next: Definition): void; openMenu: OpenMenu; kind: "personal" | "space"; keys: readonly KeyChoice[] }

function Http(p: Props): ReactElement {
  const vault = useVaultPicks();
  return <HttpForm def={p.def} node={p.node} onChange={p.onChange} openMenu={p.openMenu} vault={vault} />;
}

function Ai(p: Props): ReactElement {
  const agents = useAgentPicks();
  const who = useWhoPicks();
  const auto = useOptionalAutomationsData();
  const me = auto?.me ?? { id: "", name: "You" };
  return <AiForm def={p.def} node={p.node} onChange={p.onChange} openMenu={p.openMenu} kind={p.kind} keys={p.keys} agents={agents} who={who} me={me} {...(auto ? { lookup: auto.name } : {})} />;
}

export function LiveStepForm(p: Props): ReactElement | null {
  if (p.node.key === "http_request") return <Http {...p} />;
  if (p.node.key === "ai") return <Ai {...p} />;
  if (p.node.key === "code") return <CodeForm def={p.def} node={p.node} onChange={p.onChange} />;
  return null;
}
