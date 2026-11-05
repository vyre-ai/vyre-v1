// What a hook line in the chat offers (lane l-hooks, the approved prototype): "Edit" on an added hook; on "A hook stopped this" Details, Allow, Always allow, Deny and Ask an admin. Each is one capability, and the server
// applies the access rule: a Space hook is let go by an admin only, and anyone may ask. A refusal is said in its own words, never a bare error.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { Glyph } from "./parts.tsx";
import { hookLead } from "./model.ts";
import { actionWords } from "../../../../../../lib/hooks.ts";
import type { HookLine, HookLineAct } from "./model.ts";
import { hookLineActs } from "./model.ts";

/** How an answered stop reads, for everyone: the answer, in plain words. */
export function resolvedWords(line: HookLine): string | null {
  if (line.resolved === "denied") return "Denied. The stop stands.";
  if (line.resolved === "always") return `Always allowed for ${line.resolvedWhat ?? (line.tool ? actionWords(line.tool) : "this kind of act")}. Remove it in the hook's settings.`;
  if (line.resolved === "allowed") return "Allowed this time.";
  return null;
}

const LABEL: Readonly<Record<HookLineAct, string>> = { details: "Details", edit: "Edit", allow: "Allow", always: "Always allow", deny: "Deny", ask: "Ask an admin" };

export function HookLineActs({ id, line, threadId, call, open, linkStyle, quietStyle, stepsBelow = false }: {
  id: string; line: HookLine; /** The steps are drawn inside the agent's reply below this line */ stepsBelow?: boolean; threadId: string; call(cap: string, input: unknown): Promise<unknown>; open?: (hookId: string) => void; linkStyle: object; quietStyle: object; 
}): ReactElement | null {
  const [said, setSaid] = useState<string | null>(null);
  // an answered stop reads the same for everyone and after a reload: the line's own block says how it was answered
  const answered = resolvedWords(line);
  const [busy, setBusy] = useState(false);
  // whether this person may change the hook: it decides between Allow, Always allow and Deny, and Ask an admin
  const [canDecide, setCanDecide] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (line.kind !== "blocked" || line.hookId === undefined) return;
    let live = true;
    void Promise.resolve(call("hooks.list", { threadId })).then((r) => { if (live) setCanDecide(((r as { hooks?: Array<{ id: string; canChange?: boolean }> } | null)?.hooks ?? []).find((h) => h.id === line.hookId)?.canChange === true); }, () => { if (live) setCanDecide(false); });
    return () => { live = false; };
  }, [call, threadId, line.kind, line.hookId]);
  const acts = hookLineActs(line, canDecide).filter((a) => (a === "details" || a === "edit" ? open !== undefined : true));
  const steps = line.kind === "blocked" && line.agentId !== undefined && !stepsBelow ? line.next ?? [] : [];
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
    const run = a === "deny"
      ? call("hooks.deny", { id: hookId, threadId, messageId: id }).then(() => "Denied. The stop stands.")
      : a === "allow"
        ? call("hooks.allow_once", { id: hookId, threadId, messageId: id }).then(() => "Allowed this time. Ask again and it will go ahead.")
        : a === "always"
          // the same kind of act goes by from now on, in the hook's own scope; the hook keeps guarding the rest (the server allows it only where the person may change the hook)
          ? call("hooks.allow_always", { id: hookId, threadId, messageId: id }).then((r) => `Always allowed for ${(r as { allowed?: { what?: string } } | null)?.allowed?.what ?? "this kind of act"}. Remove it in the hook's settings.`)
          : call("hooks.ask_admin", { id: hookId, threadId }).then(() => "Asked an admin.");
    void run.then((t) => { setSaid(t); setBusy(false); }, (e) => { setSaid(e instanceof Error && e.message.trim() !== "" ? e.message.replace(/\.+$/, "") + "." : "That did not work. Try again."); setBusy(false); });
  };
  if (said !== null || answered !== null) {
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Text testID={`hook-said-${id}`} accessibilityRole="alert" style={quietStyle}>{said ?? answered}</Text>
        {open !== undefined ? <Text testID={`hook-act-details-${id}`} accessibilityRole="link" onPress={() => open(hookId)} style={linkStyle}>Details</Text> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 6, alignSelf: "flex-start" }}>
      {acts.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {/* ui-rows-lint: not a list (the few quiet verbs of one hook line) */}
          {acts.map((a) => (
            <Text key={a} testID={`hook-act-${a}-${id}`} accessibilityRole="link" accessibilityState={{ disabled: busy }} onPress={() => { if (!busy) press(a); }} style={linkStyle}>{LABEL[a]}</Text>
          ))}
        </View>
      ) : null}
      {steps.length > 0 ? (
        // the way forward the check wrote: small buttons, apart from the quiet verbs above
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {/* ui-rows-lint: not a list (the one or two step buttons a check wrote for this stop) */}
          {steps.map((st, i) => (
            <Pressable key={`n${i}`} testID={`hook-next-${i}-${id}`} accessibilityRole="button" accessibilityLabel={st.label} accessibilityState={{ disabled: busy }} onPress={() => { if (!busy) say(i); }} style={{ height: 28, paddingHorizontal: 11, justifyContent: "center", borderRadius: 9, backgroundColor: "var(--sunk)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object}>
              <Text style={{ fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string }}>{st.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One hook line in the chat: the lock, the words (the lead in ink), and under them, on every width, the quiet verbs and then the steps the check wrote. */
export function HookLineRow({ id, line, words, threadId, call, open, st, stepsBelow = false }: {
  id: string; line: HookLine; stepsBelow?: boolean; words: string; threadId: string; call(cap: string, input: unknown): Promise<unknown>; open?: (hookId: string) => void;
  st: { event: object; text: object; lead: object; act: object };
}): ReactElement {
  const [lead, rest] = hookLead(words);
  // one quiet word (Edit) sits at the right of the text when it fits; a stop with several verbs and steps puts them under it
  const inline = (line.kind === "added" || line.kind === "changed") && (line.next ?? []).length === 0;
  if (inline) {
    return (
      <View testID={`event-${id}`} accessibilityRole="text" style={[st.event, { alignItems: "flex-start" }]}>
        <View style={{ marginTop: 3 }}><Glyph name="lock" size={14} color="var(--ink-3)" /></View>
        <Text style={st.text}><Text style={st.lead}>{lead}</Text>{rest}</Text>
        <HookLineActs id={id} line={line} threadId={threadId} call={call} {...(open ? { open } : {})} linkStyle={st.act} quietStyle={st.act} stepsBelow={stepsBelow} />
      </View>
    );
  }
  return (
    <View testID={`event-${id}`} accessibilityRole="text" style={st.event}>
      <View style={{ marginTop: 3 }}><Glyph name="lock" size={14} color="var(--ink-3)" /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={st.text}><Text style={st.lead}>{lead}</Text>{rest}</Text>
        <HookLineActs id={id} line={line} threadId={threadId} call={call} {...(open ? { open } : {})} linkStyle={st.act} quietStyle={st.act} stepsBelow={stepsBelow} />
      </View>
    </View>
  );
}

/** The steps a hook check wrote, as small buttons inside the agent's reply that follows the stop. Pressing one sends its sentence to the assistant as the person's own message. */
export function HookSteps({ id, steps, agentId, threadId, call }: { id: string; steps: ReadonlyArray<{ label: string; ask: string }>; agentId: string; threadId: string; call(cap: string, input: unknown): Promise<unknown> }): ReactElement | null {
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (steps.length === 0) return null;
  if (said !== null) return <Text testID={`hook-steps-said-${id}`} accessibilityRole="alert" style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-3)" as string }}>{said}</Text>;
  const send = (i: number): void => {
    setBusy(true);
    void call("chat.post", { threadId, body: steps[i]!.ask, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `hook-next-${id}-${i}` }).then(() => { setSaid("Sent."); setBusy(false); }, () => { setSaid("That did not send. Try again."); setBusy(false); });
  };
  return (
    <View testID={`hook-steps-${id}`} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {/* ui-rows-lint: not a list (the one or two step buttons a check wrote, inside the reply) */}
      {steps.map((st, i) => (
        <Pressable key={i} testID={`hook-step-${i}-${id}`} accessibilityRole="button" accessibilityLabel={st.label} accessibilityState={{ disabled: busy }} onPress={() => { if (!busy) send(i); }} style={{ height: 28, paddingHorizontal: 11, justifyContent: "center", borderRadius: 9, backgroundColor: "var(--sunk)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object}>
          <Text style={{ fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string }}>{st.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
