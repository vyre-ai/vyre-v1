import type { ReactElement } from "react";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../generated/types.ts";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Note, ReadState, useAction, useRead } from "./shared.tsx";

type Policy = CapMap["engine.policy.get"]["out"];

const list = (values: readonly string[], empty: string): string => values.length ? values.join(", ") : empty;

export function AiPolicy(): ReactElement {
  const data = useConsoleData();
  const policy = useRead<Policy>("engine.policy.get");
  const action = useAction(policy.refresh);
  if (!policy.data) return <ReadState error={policy.error} retry={policy.refresh} />;
  const exportPolicy = (): void => {
    void action.run<CapMap["engine.use_policy.export"]["out"]>("engine.use_policy.export", {}, (out) => {
      data.nav.openApp({ screen: "files.viewer", args: { fileId: out.fileId } });
      return "AI use policy exported";
    });
  };
  return <>
    <Section title="AI use policy"><Group>
      <Row title="Accounts" note={policy.data.allowedAccounts === "company" ? "Company accounts only" : "Company and personal accounts"} />
      <Row title="Providers" note={list(policy.data.allowedProviders, "All connected providers")} />
      <Row title="Models" note={list(policy.data.allowedModels, "All allowed provider models")} />
      <Row title="Agent hops" note={String(policy.data.hops.agentHops)} />
      <Row title="Review loops" note={String(policy.data.hops.reviewLoops)} />
      <Row title="CI fix loops" note={String(policy.data.hops.ciFixLoops)} />
    </Group></Section>
    <Section title="Sensitivity label rules"><Group>
      {(["public", "internal", "confidential", "restricted"] as const).map((label) => <Row key={label} title={label[0]!.toUpperCase() + label.slice(1)} note={policy.data!.labelProviders[label] === undefined ? "Use the Space provider policy" : list(policy.data!.labelProviders[label]!, "No providers")} />)}
    </Group></Section>
    <Actions><Button label="Export policy" testID="ai-policy-export" disabled={action.busy} onPress={exportPolicy} /><Button label="Edit models and providers" onPress={() => data.nav.openPage("models")} /></Actions>
    {action.note ? <Note>{action.note}</Note> : null}
  </>;
}
