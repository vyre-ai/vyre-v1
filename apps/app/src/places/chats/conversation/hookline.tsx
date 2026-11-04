// What a hook line in the chat offers (lane l-hooks, the approved prototype): "Edit" on an added hook; on "A hook stopped this" Details, Run once anyway and Ask an admin. Each is one capability, and the server
// applies the access rule: a Space hook is let go by an admin only, and anyone may ask. A refusal is said in its own words, never a bare error.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { HookLine, HookLineAct } from "./model.ts";
import { hookLineActs } from "./model.ts";

const LABEL: Readonly<Record<HookLineAct, string>> = { details: "Details", edit: "Edit", once: "Run once anyway", ask: "Ask an admin" };

export function HookLineActs({ id, line, threadId, call, open, linkStyle, quietStyle }: {
  id: string; line: HookLine; threadId: string; call(cap: string, input: unknown): Promise<unknown>; open?: (hookId: string) => void; linkStyle: object; quietStyle: object;
}): ReactElement | null {
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const acts = hookLineActs(line).filter((a) => (a === "details" || a === "edit" ? open !== undefined : true));
  const steps = line.kind === "blocked" && line.agentId !== undefined ? line.next ?? [] : [];
  if ((acts.length === 0 && steps.length === 0) || line.hookId === undefined) return null;
  const hookId = line.hookId;
  // a step a check wrote: pressing it says its sentence to the assistant as the person's own message
  const say = (i: number): void => {
    const step = steps[i]!;
    setBusy(true);
    void call("chat.post", { threadId, body: step.ask, mentions: [{ kind: "agent", id: line.agentId }], idempotencyKey: `hook-next-${id}-${i}` }).then(() => { setSaid("Sent."); setBusy(false); }, () => { setSaid("That did not send. Try again."); setBusy(false); });
  };
  const press = (a: HookLineAct): void => {
    if (a === "details" || a === "edit") { open?.(hookId); return; }
    setBusy(true);
    const run = a === "once"
      ? call("hooks.allow_once", { id: hookId, threadId }).then(() => "Let through once. Ask again and it will go ahead.")
      : call("hooks.ask_admin", { id: hookId, threadId }).then(() => "Asked an admin.");
    void run.then((t) => { setSaid(t); setBusy(false); }, (e) => { setSaid(e instanceof Error && e.message.trim() !== "" ? e.message.replace(/\.+$/, "") + "." : "That did not work. Try again."); setBusy(false); });
  };
  if (said !== null) return <Text testID={`hook-said-${id}`} accessibilityRole="alert" style={quietStyle}>{said}</Text>;
  return (
    <View style={{ flexDirection: "row", gap: 12, marginLeft: "auto" as never }}>
      {steps.map((st, i) => (
        <Text key={`n${i}`} testID={`hook-next-${i}-${id}`} accessibilityRole="button" accessibilityState={{ disabled: busy }} onPress={() => { if (!busy) say(i); }} style={linkStyle}>{st.label}</Text>
      ))}
      {acts.map((a) => (
        <Text key={a} testID={`hook-act-${a}-${id}`} accessibilityRole="link" accessibilityState={{ disabled: busy }} onPress={() => { if (!busy) press(a); }} style={linkStyle}>{LABEL[a]}</Text>
      ))}
    </View>
  );
}
