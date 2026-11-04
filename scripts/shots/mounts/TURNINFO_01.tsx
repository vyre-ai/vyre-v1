// Mount for a reply's details (lane l-turninfo, owner 3 Nov 2026), over the Rivera sample conversation. chat.reply_details answers from a recorded turn. ?part=
//   card     (default) the conversation; the shot hovers the agent's face for the hover card
//   menu     the conversation; the shot right-clicks the reply for its menu, Details last
//   details  the right pane open on the reply's Details tab (a sign-in turn: included in the plan; one retry when the provider was busy)
//   api      the Details of a turn on a Space key, priced from the list: dollars per line, cache writes not reported
//   member   another member's view of the same reply: on Irfad's account, no cost, arguments hidden
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { ReplyDetailsPane } from "../../../apps/app/src/places/chats/details/ReplyDetailsPane.tsx";
import { readReplyDetails } from "../../../apps/app/src/places/chats/details/read.ts";
import type { ReplyDetails, ReplyTurn } from "../../../apps/app/src/places/chats/details/model.ts";
import { SidePane } from "../../../ui/src/SidePane/index.tsx";

export const title = "A reply's details";

const T0 = Date.UTC(2025, 9, 24, 9, 41, 2);
const SIGNIN: ReplyTurn = {
  turnId: "trn_01jbx4k2", traceId: "4bf92f3577b34da6a3ce929d0e0e4736", agentId: "agt_intake", asker: "usr_irfad", model: "claude-opus-5-5", effort: "high", engine: "claude_code", provider: "anthropic",
  accountKind: "subscription", accountRef: "#Irfad_Claude", state: "completed", ranOn: [{ kind: "computer", name: "Irfad's MacBook" }],
  timing: { queuedAt: T0 - 400, startedAt: T0, firstTokenAt: T0 + 2100, endedAt: T0 + 14_000 }, tokens: { in: 169_330, out: 1904, context: 52_000, cacheRead: 118_400, cacheWrite: 9650 }, cost: { source: "subscription" }, paid: "Claude Code \u00b7 your sign-in",
  tools: [
    { name: "Read", args: "fee-schedule-2025.csv", ok: true, durationMs: 1800 }, { name: "Skill", args: "engagement-letter", ok: true, durationMs: 300 },
    { name: "Edit", args: "engagement-letter.docx", ok: true, durationMs: 2400 }, { name: "records.update", args: "Elena Rivera", ok: true, durationMs: 600, heldTaskId: "tsk_hold1" },
  ],
  files: { read: ["fee-schedule-2025.csv"], written: ["engagement-letter.docx"] }, skills: ["engagement-letter"],
  switches: [{ at: T0 + 500, why: "provider.overloaded", sameAccount: true, from: "#Irfad_Claude", to: "#Irfad_Claude" }], private: false, partial: false,
};
const API: ReplyTurn = {
  ...SIGNIN, model: "claude-sonnet-5-5", effort: "medium", engine: "anthropic", accountKind: "api_key", shared: true, accountRef: "#Team_Anthropic", ranOn: [{ kind: "space", name: "The Space" }],
  tokens: { in: 29_989, out: 1769, cacheRead: 20_000 }, paid: "OpenCode Go \u00b7 Space account", switches: [],
  cost: { source: "catalog", micros: 41_668, priceAsOf: "2026-10-06", lines: [{ kind: "input", tokens: 9989, perMillion: 2, micros: 19_978 }, { kind: "output", tokens: 1769, perMillion: 10, micros: 17_690 }, { kind: "cache_read", tokens: 20_000, perMillion: 0.2, micros: 4000 }] },
};
const MEMBER: ReplyTurn = { ...SIGNIN, private: true, tools: SIGNIN.tools.map((x) => ({ name: x.name, ...(x.ok === undefined ? {} : { ok: x.ok }), ...(x.durationMs === undefined ? {} : { durationMs: x.durationMs }), ...(x.heldTaskId ? { heldTaskId: x.heldTaskId } : {}) })), files: { read: [], written: [] }, switches: SIGNIN.switches.map((s) => ({ at: s.at, why: s.why, sameAccount: s.sameAccount })) };
delete (MEMBER as Partial<ReplyTurn>).cost;
delete (MEMBER as Partial<ReplyTurn>).accountRef;
const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_omar: "Omar Haddad", agt_intake: "Intake" };

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const part = new URLSearchParams(search ?? "").get("part") ?? "card";
  const [open, setOpen] = useState<string | null>(null);
  const turn = part === "api" ? API : part === "member" ? MEMBER : SIGNIN;
  const sample = useMemo(() => createSample("idle"), []);
  const reply = useMemo(() => (sample.replica.rows("messages") as unknown as Array<{ messageId: string; author: { kind: string }; body: string }>).find((m) => m.author.kind === "agent" && m.body !== "")?.messageId ?? "", [sample]);
  const meId = part === "member" ? "usr_omar" : "usr_irfad";
  const call = useMemo(() => async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "chat.reply_details") {
      const id = (input as { messageId: string }).messageId;
      const details: ReplyDetails = { messageId: id, threadId: "c1", agentId: "agt_intake", at: T0, turn, memory: { facts: [{ factId: "fct_1", text: "Rivera's matter is a family-law consult", sourceTitle: "Rivera intake" }, { factId: "fct_2", text: "The retainer needs Maya's sign-off", sourceTitle: "Fees" }], quotes: [] }, steps: [] };
      return { details };
    }
    if (cap === "engine.accounts.list") return { accounts: part === "member" ? [] : [{ ref: "#Irfad_Claude", name: "Your Claude sign-in (Max)" }, { ref: "#Team_Anthropic", name: "Anthropic API · Team credits" }] };
    return sample.data.call(cap as never, input as never);
  }, [part, turn, sample]);
  const nameOf = (id: string): string => (id === meId ? "You" : NAMES[id] ?? sample.data.nameOf(id));
  const details = useMemo(() => ({ read: (id: string) => readReplyDetails(call, "c1", id), open: (id: string) => setOpen(id), meId, nameOf: (id: string) => NAMES[id] ?? sample.data.nameOf(id) }), [call, meId, sample]);
  const data = useMemo(() => ({ ...sample.data, call: call as typeof sample.data.call, me: { id: meId, name: "You" }, nameOf, nav: { ...sample.data.nav, openDetails: (_t: string, mid: string) => setOpen(mid) } }), [sample, call, meId]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (search !== null && (part === "details" || part === "api" || part === "member") && reply) setOpen(reply); }, [search, part, reply]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      <View style={{ flex: 1 }}><Conversation data={data} /></View>
      {open ? (
        <View style={{ width: 372 }}>
          <SidePane paneKey="turninfo-pane" toggle={{ open: true, onPress: () => setOpen(null) }} title="Details" tabs={[{ key: "details", title: "Details" }]} activeTab="details" onSelectTab={() => undefined} onCloseTab={() => setOpen(null)} defaultWidth={372}>
            <ReplyDetailsPane key={open} messageId={open} details={details} copy={() => undefined} when="9:41" />
          </SidePane>
        </View>
      ) : null}
    </View>
  );
}
