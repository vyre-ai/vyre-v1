// Mount for the l-cards lane: the chat cards as they draw, one part at a time, or all together. ?part=
//   all                the error, approval, held message, key request, access, terminal, mount, note offer and redact cards in one column
//   err | err-acct     the error card with its next steps and Details; and the one for a missing AI account
//   approval | approval-deny | approval-done        the approval card (a file edit with its diff), after Deny, and answered
//   held | held-edit | held-deny                    the held message card, with Edit open, and asking why on Deny
//   key | key-deny     the key request card, and after Deny
//   access | terminal | mount | noteoffer | redact
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { ErrorRowView } from "../../../apps/app/src/places/chats/conversation/MessageView.tsx";
import { statusView } from "../../../apps/app/src/places/chats/conversation/status.ts";
import { ApprovalCard } from "../../../apps/app/src/places/chats/conversation/approval.tsx";
import { KeyRequestCard } from "../../../apps/app/src/places/chats/conversation/keyrequest.tsx";
import { AccessRequestCard } from "../../../apps/app/src/places/chats/conversation/accessrequest.tsx";
import { TerminalCard } from "../../../apps/app/src/places/chats/conversation/TerminalCard.tsx";
import { MountCard } from "../../../apps/app/src/places/chats/conversation/mountcard.tsx";
import { NoteOfferCard } from "../../../apps/app/src/places/chats/conversation/noteoffer.tsx";
import { GoalCard } from "../../../apps/app/src/places/chats/goals/GoalCard.tsx";
import { InstallCard } from "../../../apps/app/src/places/chats/install/InstallCard.tsx";
import { QuoteCard, WebPageCard } from "../../../apps/app/src/places/chats/conversation/webpage.tsx";
import { RedactRequestCard } from "../../../apps/app/src/places/chats/conversation/redactrequest.tsx";

export const title = "Chat cards";

const stub = { showMenu: () => undefined, copy: () => undefined, retryTurn: () => undefined, errorNext: () => undefined } as never;
const never = (): void => undefined;
const errBlock = (data: Record<string, unknown>): never => {
  const v = statusView({ id: "b1", type: "turn_status", v: 1, traceId: "trc_9f3a21", data: { state: "failed", turnId: "trn_1", ...data } } as never, { admin: true });
  return (v.kind === "error" ? v.block : null) as never;
};

const FILE = { type: "doc_excerpt", v: 1, data: { act: "approve", cap: "files.write", input: { fileId: "fil_1", content: { text: "Q4 pricing\nBasic 49\nPro 99 a month" }, reason: "Agent edit", idempotencyKey: "k" } } };
const DM = { type: "approval_preview", v: 1, data: { act: "send", cap: "chat.message_person", input: { to: "usr_aliza", body: "Hi **Aliza**,\n\n- the deed is ready\n- call me when you can", timing: "online" }, holdId: "hld_1", outward: { channel: "message", to: [{ kind: "person", id: "usr_aliza" }], body: "Hi **Aliza**,\n\n- the deed is ready\n- call me when you can", bodyField: "body", schedule: { kind: "online" } } } };

function call(state: string) {
  return async (cap: string): Promise<unknown> => {
    if (cap === "tasks.get") return { task: { id: "tsk_1", kind: "approve", title: "Approve", state, blocks: [state === "dm" || state === "dm-done" ? DM : FILE], actions: [], updatedAt: Date.UTC(2026, 10, 6, 9, 30) } };
    if (cap === "files.get") return { file: { name: "Q4 pricing.docx" } };
    if (cap === "files.read") return { text: "Q4 pricing\nBasic 39 a month\nPro 99 a month" };
    if (cap === "access.principals.get") return { principal: { name: "Aliza Rizvi" } };
    if (cap === "settings.public_of") return {};
    if (cap === "vault.requests.get") return { request: { id: "vrq_1", name: "Fathom", fields: ["api_key"], reason: "To read your meeting recordings.", state: "waiting", folderId: "vfd_1" } };
    if (cap === "vault.requests.list") return { requests: [{ id: "vrq_1" }] };
    if (cap === "access.requests.list") return { requests: [{ id: "arq_1", state: "waiting" }] };
    if (cap === "files.marks.list") return { requests: [{ requestId: "rrq_1" }] };
    return {};
  };
}
const changes = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) } as never;
const gdata = (state: string) => ({ call: call(state), nav: { openBeside: never }, threadId: "thr_1", changes, nameOf: (x: string) => (x === "usr_maya" ? "Maya Chen" : x) }) as never;
const deps = { call: async () => ({}), newKey: () => "k", sleep: async () => undefined } as never;

const Err = ({ acct }: { acct?: boolean }): ReactNode => <ErrorRowView block={errBlock(acct ? { code: "no_account" } : { code: "engine.cli_error", exit: "1" })} actions={stub} />;
const Approval = ({ state = "awaiting_approval" }: { state?: string }): ReactNode => <ApprovalCard taskId="tsk_1" agent="Intake" agentId="agt_1" data={gdata(state)} />;
const Held = ({ state = "awaiting_approval" }: { state?: string }): ReactNode => <ApprovalCard taskId="tsk_1" agent="Dex" agentId="agt_dex" data={gdata(state === "awaiting_approval" ? "dm" : state)} />;
const Key = (): ReactNode => <KeyRequestCard requestId="vrq_1" agent="Ops" agentId="agt_ops" data={gdata("x")} />;
const Access = (): ReactNode => <AccessRequestCard block={{ requestId: "arq_1", requester: "usr_maya", resourceTitle: "Fathom", level: "use", note: "For the Monday intake review." }} data={gdata("x")} />;
const Terminal = (): ReactNode => <TerminalCard id="t1" why="Install ffmpeg so I can cut the recording." command="sudo apt install ffmpeg" risk={"danger" as never} host="device" deps={deps} copy={never} openTerminal={never} answer={never} />;
const Mount = (): ReactNode => <MountCard id="m1" prompt="Where are the client files?" offers={[{ source: "google_drive", label: "Google Drive", brand: "gdrive" }, { source: "github", label: "GitHub", brand: "github" }] as never} agents={[]} data={gdata("x")} answer={never} />;
const Note = (): ReactNode => <NoteOfferCard id="n1" mine data={{ blockId: "b1", title: "Intake call checklist", body: "Ask for the date of loss, the adjuster's name and whether they have seen a doctor.", state: "offered" }} chat={gdata("x")} />;
const Redact = (): ReactNode => <RedactRequestCard block={{ requestId: "rrq_1", fileId: "fil_9", name: "Medical records.pdf" }} agent="Intake" data={gdata("x")} />;

const NOW = Date.UTC(2026, 10, 6, 9, 0) + 5 * 86_400_000;
const goalCall = async (): Promise<unknown> => ({ goal: { status: "draft", deadline: NOW, progress: { tasksDone: 0, tasks: 0 } } });
const Goal = (): ReactNode => <GoalCard block={{ goalId: "gol_1", threadId: "thr_c", kind: "draft", title: "300 registrations for Lab 8", line: "Luma registrations reach 300", status: "draft", target: 300, deadline: NOW, plan: ["Remind Lab 7 (31% after one reminder)"], permissions: ["Send email from the Lab template"] } as never} call={goalCall} changes={undefined} me="usr_irfad" />;
const PLAN = { planId: "ins_1", state: "planned", kind: "skill", name: "pdf-tools", summary: "Reads, splits and fills in PDF forms for your agents.", repo: "acme/pdf-tools", commit: "a41f9c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", url: "https://github.com/acme/pdf-tools", needs: { domains: ["api.example.com"], vaultKeys: [], files: [] }, skills: ["pdf-tools"], problems: [], who: [{ key: "me", label: "Just you", allowed: true }, { key: "agent", label: "This agent", allowed: true }] };
const Install = (): ReactNode => <InstallCard id="m1" data={{ planId: "ins_1", name: "pdf-tools", kind: "skill" }} chat={{ call: (async (cap: string) => (cap === "install.get" ? { plan: PLAN } : { items: [] })) as never, openSkills: never }} />;
const Web = (): ReactNode => <><WebPageCard id="w1" data={{ url: "https://vegalaw.com/intake", title: "Intake form, Vega Family Law" }} /><QuoteCard id="q1" data={{ text: "She said her firm loses every lead that comes in after 5 PM, and she wants answers the same night.", url: "https://vegalaw.com/intake" }} /></>;

export default function Mount_(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "all"), []);
  const { width, height } = useWindowDimensions();
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const one: Record<string, ReactNode> = {
    err: <Err />, "err-acct": <Err acct />, approval: <Approval />, "approval-deny": <Approval />, "approval-done": <Approval state="done" />,
    held: <Held />, "held-edit": <Held />, "held-deny": <Held />, key: <Key />, "key-deny": <Key />, access: <Access />, terminal: <Terminal />, mount: <Mount />, noteoffer: <Note />, redact: <Redact />, goal: <Goal />, install: <Install />, web: <Web />,
  };
  const body = part === "all" ? <>{[<Err key="e" />, <Approval key="a" />, <Held key="h" />, <Key key="k" />, <Access key="x" />, <Terminal key="t" />, <Mount key="m" />, <Note key="n" />, <Redact key="r" />, <Goal key="g" />, <Install key="i" />, <Web key="w" />]}</> : one[part] ?? null;
  return (
    <View style={{ height, backgroundColor: "var(--win)" as string }}>
      <ScrollView contentContainerStyle={{ alignItems: "center", paddingTop: 16, paddingBottom: 40 }}>
        <View style={{ width: Math.min(640, width - 32), gap: 6 }}>{body}</View>
      </ScrollView>
    </View>
  );
}
