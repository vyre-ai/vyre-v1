import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { useConsoleData } from "../shell/data.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Button, Field, Note } from "./shared.tsx";

export function Checker(): ReactElement {
  const { call } = useConsoleData();
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState("person");
  const [resourceType, setResourceType] = useState("folder");
  const [resourceId, setResourceId] = useState("");
  const [permission, setPermission] = useState("");
  const [level, setLevel] = useState("view");
  const [out, setOut] = useState<CapMap["access.check"]["out"] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try { setOut(await call("access.check", { principal: { kind, id: person.trim() }, resource: { type: resourceType, id: resourceId.trim() }, action: { level, ...(permission.trim() ? { perm: permission.trim() } : {}) } }) as CapMap["access.check"]["out"]); }
    catch { setError("Couldn’t check this access. Check the person, resource and permission."); }
    finally { setBusy(false); }
  };
  return <View testID="console-checker"><Section title="Check access"><Group><Field label="Principal kind (person, agent, actor or service)" value={kind} onChange={setKind} /><Field label="Principal id" testID="checker-principal" value={person} onChange={setPerson} /><Field label="Resource type" value={resourceType} onChange={setResourceType} /><Field label="Resource id" testID="checker-resource" value={resourceId} onChange={setResourceId} /><Field label="Permission (optional)" value={permission} onChange={setPermission} /><Field label="Level (view, use, edit or manage)" value={level} onChange={setLevel} /><Button label="Check access" testID="checker-run" disabled={busy || !person.trim() || !resourceId.trim() || !["person", "agent", "actor", "service"].includes(kind) || !["view", "use", "edit", "manage"].includes(level)} onPress={() => void check()} /></Group></Section>{error ? <Note>{error}</Note> : null}{out ? <Section title="Decision"><Text testID="checker-decision">{out.decision.effect}</Text><Note>{out.decision.reason}</Note>{out.decision.steps.map((step, index) => <Text key={index}>{step.ok ? "✓" : "×"} {step.text}</Text>)}</Section> : null}</View>;
}
