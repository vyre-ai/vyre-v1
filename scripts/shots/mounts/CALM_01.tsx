// Mount for l-calm: the Chats sidebar beside a conversation with runs of messages, a day line, system lines, a rich reply (sections, chart, code, highlight) and cards, to set against the prototype's amicuspro scene.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { sampleGoals } from "../../../apps/app/src/places/chats/goals/sample.ts";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";

export const title = "Calm chat";

const RICH = [
  "**Short answer:** start with the 14 active accounts. The other 22 are _paused or empty_, and ==three need a new login before anything else==.", "",
  "I read the list with `crm accounts list --active` in my workspace.", "",
  "> [!section+] What I found",
  "> North, Harbor and Pine send most of the messages. Lake and Mesa have no welcome flow yet.", "",
  "> [!section] How I checked",
  "> Tess opened each account's settings. Orin counted messages in a terminal.", "",
  "```chart", '{"type":"bar","title":"Messages sent per account","labels":["North","Harbor","Pine","Lake","Mesa","Bay"],"series":[{"name":"Sent","data":[96,76,60,42,28,16]}]}', "```", "",
  "- [x] Map the 14 active accounts", "- [ ] Fix the three logins", "- [ ] Add a welcome flow to Lake and Mesa", "",
  "Which should I do first?",
].join("\n");

export default function Mount(): ReactNode {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const sb = useMemo(() => {
    const now = Date.UTC(2025, 9, 24, 10, 0);
    const base = createSampleSidebar(northwind, { goals: sampleGoals(now, "stuck").lines as never }).data;
    return { ...base, call: async (cap: string, input: unknown) => cap === "home.digest" ? { digest: { id: "dg1", headline: ["Three things happened"], items: [{ title: "Rivera intake", line: "Form came back", subject: { type: "thread", id: "c1" } }, { title: "Billing", line: "12 invoices ready", subject: { type: "thread", id: "c2" } }, { title: "Docs", line: "Letter drafted", subject: { type: "thread", id: "c3" } }] } } : base.call(cap, input) };
  }, []);
  const sample = useMemo(() => {
    const s = createSample("idle");
    const base = Date.UTC(2025, 9, 24, 9, 40);
    const a = { kind: "agent" as const, id: "agt_intake" };
    const p = { kind: "person" as const, id: "usr_maya" };
    const row = (id: string, author: { kind: "person" | "agent"; id: string }, body: string, min: number) => ({ id, messageId: id, threadId: "c1", threadSeq: 100 + min, author, kind: author.kind === "agent" ? "agent" : "text", body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: base + min * 60_000 });
    s.replica.put("messages", [
      row("z1", p, "Can you map the client accounts in the CRM and tell us where to start?", 0),
      row("z2", p, "Harbor's login code goes to my phone, ping me.", 1),
      row("z3", a, RICH, 3),
      row("z4", a, "I have started on the three logins. North is done.", 5),
      { ...row("z5", a, "", 6), kind: "system", blocks: [{ type: "link_card", v: 1, id: "lc1", data: { icon: "thread", lead: "Connected", title: "with Aliza. Intake is talking with Aliza directly." } }] },
      { ...row("z6", a, "", 7), kind: "system", blocks: [{ type: "link_card", v: 1, id: "lc2", data: { icon: "fact", lead: "Noted", title: "decision, go with Harbor", style: "noted" } }] },
      { ...row("z7", a, "", 8), kind: "system", blocks: [{ type: "link_card", v: 1, id: "lc3", data: { icon: "fact", lead: "Remembered", title: "Harbor sends its login code to Omar" } }] },
    ]);
    return s;
  }, []);
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      {phone ? null : <View style={{ width: 272, backgroundColor: "var(--side)" as string }}><ChatsSidebar data={sb} window={{ start: 0, end: 500 }} open={null} /></View>}
      <View style={{ flex: 1, minWidth: 0 }}><Conversation data={sample.data} /></View>
    </View>
  );
}
