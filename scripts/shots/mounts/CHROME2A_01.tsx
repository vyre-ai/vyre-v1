// Mount for Chrome step 2 part A (lane l-chrome2a): the app's side of agents working in the person's own Chrome. ?part=
//   conn        Vault > Connections with Browser connections in Mine: each site, where it runs and what each agent may do
//   site        the Add a site sheet: the site, My Chrome, Agent computers or Both, a right for each agent, and the always-held line
//   held        the approval card in a chat: To, From, Subject, Message, with Send, Edit and Don't send
//   held-done   the same card after Send: it says Sent
//   gate-dm | gate-email | gate-text | gate-post | gate-long   the one held card for a message, an email, a text, a channel post, a long body cut at twelve lines with Show all
//   gate-edit | gate-reason | gate-sent | gate-dropped | gate-edited   the same card with Edit open, Don't send asking why, after Send, after Don't send, and after a Save
//   step        "Using your Chrome" with a masked picture of the tab, Watch and Take over
//   step-saw    the same step, with "Show what Scout saw" open: the handles it was given, names only
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import { createSampleVault } from "../../../apps/app/src/places/vault/layout/sample.ts";
import { sampleConnectionsCall, sampleConnectionsData } from "../../../apps/app/src/places/vault/connections/sample.ts";
import { ApprovalCard } from "../../../apps/app/src/places/chats/conversation/approval.tsx";
import { MessageView } from "../../../apps/app/src/places/chats/conversation/MessageView.tsx";
import { timeline } from "../../../apps/app/src/places/chats/conversation/model.ts";
import type { Message } from "../../../apps/app/src/places/chats/conversation/model.ts";

export const title = "Agents in your Chrome";

/** The picture the extension sends is a small JPEG of the tab. The mount draws one in the browser, so the card shows what it shows in the product. */
function drawShot(): string {
  const doc = (globalThis as { document?: { createElement(t: string): any } }).document;
  const c = doc?.createElement("canvas");
  const g = c?.getContext?.("2d");
  if (!c || !g) return "";
  c.width = 320; c.height = 200;
  g.fillStyle = "#F5F7FB"; g.fillRect(0, 0, 320, 200);
  g.fillStyle = "#fff"; g.fillRect(0, 0, 320, 22); g.fillRect(40, 36, 240, 150);
  g.fillStyle = "#1d2433"; g.font = "600 9px sans-serif"; g.fillText("Contacts", 10, 15);
  g.font = "8px sans-serif"; g.fillText("Marisol Vega", 52, 56); g.fillStyle = "#6B778C"; g.fillText("Vega Family Law", 52, 70); g.fillText("marisol@vegalaw.com", 52, 84);
  g.fillStyle = "#E4E8F0"; g.fillRect(52, 98, 216, 40); g.fillRect(52, 146, 120, 10);
  g.strokeStyle = "#4f46e5"; g.lineWidth = 4; g.strokeRect(2, 2, 316, 196);
  g.fillStyle = "#1e1b4b"; g.fillRect(104, 174, 112, 16); g.fillStyle = "#fff"; g.font = "7px sans-serif"; g.fillText("Scout is using this tab", 114, 185);
  return c.toDataURL("image/jpeg", 0.8);
}

const HELD = { heldId: "hld_a1b2c3", agent: "Scout", site: "mail.google.com", kind: "send", state: "waiting", card: { to: "dana@client.test", from: "olivia@firm.test", subject: "Your signed deed", message: "Hi Dana,\n\nThe signed deed is attached. Call me if anything looks off before Friday.\n\nOlivia" } };

function message(part: string, thumb: string): Message {
  const blocks = part.startsWith("held")
    ? [{ id: "blk_h", type: "chrome_held", v: 1, state: "waiting", data: part === "held-done" ? { ...HELD, state: "sent" } : HELD }]
    : [{ id: "blk_s", type: "chrome_step", v: 1, state: "live", data: { agent: "Scout", site: "app.gohighlevel.com", thumb: thumb || null, state: "using", ...(part === "step" ? { goal: "Add tags", steps: [{ text: "Opened Contacts and the list \"Lab 7 registered, not attended\" (14)", state: "done" }, { text: "Added the tag lab-7-noshow (14 of 14)", state: "done" }, { text: "Enrolled them in the workflow Lab 8 nurture", state: "done" }, { text: "Drafted the email in Bulk email", state: "done" }, { text: "Send waits for you", state: "waiting" }] } : {}), ...(part === "step-saw" ? { saw: ["#GoHighLevel_Olivia.username", "#GoHighLevel_Olivia.password"], open: true } : {}) } }];
  return {
    messageId: "msg_c2a", threadId: "thr_c2a", threadSeq: 1, author: { kind: "agent", id: "agt_scout" }, kind: "agent",
    body: part.startsWith("held") ? "The email to Dana is written. It is waiting for your go-ahead." : "I am in your Chrome, in the Marisol Vega contact.",
    blocks: blocks as never, depth: 0, attachments: [], reactions: [], pinned: false, createdAt: Date.UTC(2026, 10, 4, 9, 30),
  } as unknown as Message;
}

const NAMES: Record<string, string> = { agt_scout: "Scout", usr_olivia: "Olivia Reed" };

function Chat({ part }: { part: string }): ReactNode {
  const [thumb, setThumb] = useState("");
  useEffect(() => setThumb(drawShot()), []);
  const items = useMemo(() => timeline([message(part, thumb)], { meId: "usr_olivia", nameOf: (id: string) => NAMES[id] ?? id, kindOf: (id: string) => (id.startsWith("agt_") ? "agent" : "person"), clock: { now: Date.UTC(2026, 10, 4, 15, 0), offsetMin: -300 } }), [part, thumb]);
  const actions = useMemo(() => ({ nameOf: (id: string) => NAMES[id] ?? id, chrome: { send: async () => ({ sent: true }), drop: async () => undefined, watch: async () => undefined, takeOver: async () => undefined }, copy() {}, openThread() {}, setPinned() {}, react() {}, remove() {}, openAgent() {}, showMenu() {} }), []);
  return (
    <View style={{ flex: 1, minHeight: 520, padding: 24, backgroundColor: "var(--win)" as string }}>
      <View style={{ maxWidth: 720, width: "100%" }}>{items.map((it) => <MessageView key={it.key} item={it} actions={actions as never} meId="usr_olivia" />)}</View>
    </View>
  );
}

const LONG = Array.from({ length: 16 }, (_, i) => `- item ${i + 1}: the draft for the ${["Rivera", "Okafor", "Lindqvist", "Tanaka", "Moreau", "Haddad", "Novak", "Bianchi"][i % 8]} file`).join("\n");
const BODY = "Hi **Aliza**,\n\nThe signed deed is ready. Two things before Friday:\n\n- the [county form](https://county.example/form)\n- a call with me\n\nOlivia";
const GATE: Record<string, { cap: string; input: Record<string, unknown>; outward: Record<string, unknown> }> = {
  dm: { cap: "chat.message_person", input: { to: "usr_aliza", body: BODY, timing: "online" }, outward: { channel: "message", to: [{ kind: "person", id: "usr_aliza" }], body: BODY, bodyField: "body", schedule: { kind: "online" } } },
  email: { cap: "mail.send", input: { to: ["aliza@firm.test"], subject: "Your signed deed", body: BODY }, outward: { channel: "email", to: [{ kind: "address", address: "aliza@firm.test" }], subject: "Your signed deed", body: BODY, bodyField: "body" } },
  text: { cap: "telephony.send_sms", input: { to: "+14155550123", text: "Your deed is ready. Reply YES to book a signing." }, outward: { channel: "text", to: [{ kind: "address", address: "+14155550123" }], body: "Your deed is ready. Reply YES to book a signing.", bodyField: "text" } },
  post: { cap: "chat.post", input: { threadId: "thr_team", body: "**Heads up:** the Rivera closing moved to Friday." }, outward: { channel: "post", to: [{ kind: "channel", name: "Team" }], body: "**Heads up:** the Rivera closing moved to Friday.", bodyField: "body" } },
  event: { cap: "google.calendar.create_event", input: { summary: "Rivera closing prep", description: "Agenda\n- the deed\n- the fee", location: "https://us02web.zoom.us/j/123456", sendUpdates: "all", start: { dateTime: "2026-11-04T14:00:00-08:00", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-11-04T15:00:00-08:00", timeZone: "America/Los_Angeles" }, attendees: [{ email: "dana@client.test" }, { email: "sam@firm.test" }] }, outward: {} },
  long: { cap: "chat.message_person", input: { to: "usr_aliza", body: LONG }, outward: { channel: "message", to: [{ kind: "person", id: "usr_aliza" }], body: LONG, bodyField: "body" } },
};
function Gate({ part }: { part: string }): ReactNode {
  const kind = part === "gate-email" ? "email" : part === "gate-text" ? "text" : part === "gate-post" ? "post" : part === "gate-long" ? "long" : part === "gate-event" ? "event" : "dm";
  const g = GATE[kind]!;
  const state = part === "gate-sent" ? "done" : part === "gate-dropped" ? "canceled" : "awaiting_approval";
  const edited = part === "gate-edited" ? { by: "usr_olivia", at: Date.UTC(2026, 10, 4, 4, 30) } : undefined;
  const data = useMemo(() => ({
    call: async (cap: string) => {
      if (cap === "tasks.get") return { task: { id: "tsk_g", kind: "approve", title: "Approve: Send a message", state, ...(part === "gate-dropped" ? { workingNotes: { decision: "rejected" } } : {}), blocks: [{ type: "approval_preview", v: 1, data: { act: "send", cap: g.cap, input: g.input, holdId: "hld_g", outward: { ...g.outward, ...(edited ? { edited } : {}) } } }], updatedAt: Date.UTC(2026, 10, 4, 4, 38) } };
      if (cap === "access.principals.get") return { principal: { name: "Aliza Rizvi" } };
      return {};
    },
    nav: { openBeside: () => undefined },
  }), [kind, part]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ flex: 1, minHeight: 520, padding: 24, backgroundColor: "var(--win)" as string }}>
      <View style={{ maxWidth: 720, width: "100%" }}><ApprovalCard taskId="tsk_g" agent="Dex" agentId="agt_dex" data={data as never} /></View>
    </View>
  );
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "conn"), []);
  const data = useMemo(() => { const v = createSampleVault(); return { ...v.data, assistantId: "agt_assistant", call: sampleConnectionsCall(v.data.call, { admin: true }), nav: { ...v.data.nav, openConnections: () => undefined } }; }, []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "conn" || part === "site") {
    return (
      <View style={{ flex: 1, minHeight: 760 }}>
        <Vault data={data} route={{ surface: "connections" }} connectionsInitial={sampleConnectionsData({ admin: true })} {...(part === "site" ? { connectionsSite: true } : {})} />
      </View>
    );
  }
  if (part.startsWith("gate-")) return <Gate part={part} />;
  return <Chat part={part} />;
}
