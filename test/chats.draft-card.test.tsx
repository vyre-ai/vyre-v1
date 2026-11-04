// An agent's email draft is a held email card in the chat where it was asked (lane l-chrome2a): who it goes to, the subject and the words, Edit and Send and Don't send, and nothing sent until Send.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { TextInput } from "react-native";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../ui/src/testing/dom.ts";
import { DraftCard, ProviderDraftCard } from "../apps/app/src/places/chats/conversation/draft-card.tsx";
import { workCardOf } from "../agent/src/tools/work-cards.ts";
import { draftOf } from "../ui/src/blocks/link-card/state.ts";
import { linkCardOf } from "../ui/src/blocks/link-card/model.ts";

installDom();
type Call = { cap: string; input: any };   // eslint-disable-line @typescript-eslint/no-explicit-any

function world(o: { status?: string; gone?: boolean } = {}) {
  const calls: Call[] = [];
  const st = { subject: "Re: the lease", text: "Hi **Josh**,\n\nThe lease is attached.", status: o.status ?? "draft" };
  const d = {
    call: async (cap: string, input: any) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      calls.push({ cap, input });
      if (cap === "mail.message.get") { if (o.gone) throw new Error("gone"); return { message: { mailboxId: "mbx_1", to: [{ address: "josh@firm.test", name: "Josh Park" }], cc: [], subject: st.subject, status: st.status }, text: st.text }; }
      if (cap === "mail.draft") { st.text = input.text; if (input.subject !== undefined) st.subject = input.subject; return { draftId: "eml_1" }; }
      if (cap === "mail.send") { st.status = "queued"; return { messageId: "eml_1", status: "queued", suppressed: [] }; }
      if (cap === "mail.drafts.discard") return { discarded: true };
      return {};
    },
    nav: { openBeside: () => undefined },
    threadId: "thr_1",
  } as never;
  return { d, calls };
}
const editor = ({ value, onChange, label }: { value: string; onChange: (m: string) => void; label: string }) => <TextInput testID="stub-editor" accessibilityLabel={label} value={value} onChangeText={onChange} multiline />;

test("an agent's draft shows as the held email card: who, subject, the words formatted, Send, Edit and Don't send; nothing is sent", async () => {
  const w = world();
  const root = await mount(createRoot, <DraftCard draftId="eml_1" agent="Dex" data={w.d} />);
  await flush();
  const t = textOf(root);
  assert.match(t, /Dex wants to email Josh Park/);
  assert.match(t, /Re: the lease/);
  assert.match(t, /The lease is attached\./);
  assert.ok(!t.includes("**"), "formatted, not raw");
  assert.ok(find(root, "draft-eml_1-send") && find(root, "draft-eml_1-edit") && find(root, "draft-eml_1-drop"));
  assert.equal(w.calls.some((c) => c.cap === "mail.send"), false, "nothing sent yet");
});

test("Edit then Send: the edited words are saved to the draft and that draft is sent, as the person", async () => {
  const w = world();
  const root = await mount(createRoot, <DraftCard draftId="eml_1" agent="Dex" data={w.d} editor={editor} />);
  await flush();
  await press(find(root, "draft-eml_1-edit"));
  await typeInto(find(root, "stub-editor")!, "Hi Josh, short version.");
  await press(find(root, "draft-eml_1-save")); await flush();
  assert.deepEqual(w.calls.find((c) => c.cap === "mail.draft")!.input.text, "Hi Josh, short version.");
  assert.equal(w.calls.find((c) => c.cap === "mail.draft")!.input.draftId, "eml_1");
  await press(find(root, "draft-eml_1-send")); await flush();
  const sent = w.calls.find((c) => c.cap === "mail.send")!.input;
  assert.equal(sent.draftId, "eml_1");
  assert.equal(sent.text, "Hi Josh, short version.");
  assert.match(textOf(root), /Sent to Josh Park · \d\d:\d\d/);
});

test("Don't send discards the draft and says Not sent; a draft that is gone reads Not sent too; one already sent reads Sent", async () => {
  const w = world();
  const root = await mount(createRoot, <DraftCard draftId="eml_1" agent="Dex" data={w.d} />);
  await flush();
  await press(find(root, "draft-eml_1-drop")); await press(find(root, "draft-eml_1-drop-go")); await flush();
  assert.ok(w.calls.some((c) => c.cap === "mail.drafts.discard" && c.input.draftId === "eml_1"));
  assert.match(textOf(root), /Not sent/);
  const gone = await mount(createRoot, <DraftCard draftId="eml_2" agent="Dex" data={world({ gone: true }).d} />);
  await flush();
  assert.match(textOf(gone), /Not sent/);
  const done = await mount(createRoot, <DraftCard draftId="eml_3" agent="Dex" data={world({ status: "sent" }).d} />);
  await flush();
  assert.match(textOf(done), /Sent to Josh Park/);
});

test("a drafted email is a work card the chat draws as this card", () => {
  const card = workCardOf("mail.draft", { mailboxId: "mbx_1", subject: "Re: the lease" }, { draftId: "eml_9" });
  assert.deepEqual([card?.icon, card?.lead, card?.title, card?.target], ["draft", "Draft", "Re: the lease", { type: "draft", id: "eml_9" }]);
  const lc = linkCardOf({ type: "link_card", data: { icon: card!.icon, lead: card!.lead, title: card!.title, target: card!.target } });
  assert.equal(draftOf(lc!), "eml_9");
  assert.equal(workCardOf("mail.draft", {}, {}), null, "a draft that was not made is no card");
});

test("Don't send with a reason goes back to the agent as a line in the chat and a refusal in its memory", async () => {
  const w = world();
  const root = await mount(createRoot, <DraftCard draftId="eml_1" agent="Dex" agentId="agt_dex" data={w.d} />);
  await flush();
  await press(find(root, "draft-eml_1-drop"));
  await typeInto(find(root, "draft-eml_1-reason")!, "Josh is on leave, ask Sam");
  await press(find(root, "draft-eml_1-drop-go")); await flush();
  const post = w.calls.find((c) => c.cap === "chat.post")!.input;
  assert.equal(post.threadId, "thr_1");
  assert.deepEqual(post.mentions, [{ kind: "agent", id: "agt_dex" }]);
  assert.match(post.body, /Don't send that email \("Re: the lease"\)\. Josh is on leave, ask Sam/);
  assert.deepEqual(w.calls.find((c) => c.cap === "memory.corrections.record")!.input, { agentId: "agt_dex", how: "refuse", was: "Hi **Josh**,\n\nThe lease is attached.", now: "", note: "Josh is on leave, ask Sam" });
});

const gmailCard = () => {
  const c = workCardOf("google.gmail.create_draft", { connectionId: "con_1", to: ["josh@firm.test"], subject: "Re: the lease", text: "Hi Josh, the lease is attached.", threadId: "t1" }, { draftId: "dr_1" })!;
  return linkCardOf({ type: "link_card", data: { icon: c.icon, lead: c.lead, title: c.title, target: c.target, to: c.to, via: c.via, body: c.body, actions: c.actions } })!;
};

test("a draft kept at Gmail or Outlook is a work card carrying its words and the two calls its buttons make", () => {
  const lc = gmailCard();
  assert.equal(lc.target?.type, "provider_draft");
  assert.equal(lc.to, "josh@firm.test");
  assert.deepEqual(lc.actions!.map((a) => [a.key, a.cap]), [["send", "google.gmail.send_message"], ["discard", "google.gmail.delete_draft"]]);
  assert.equal(lc.actions![1]!.input!["draftId"], "dr_1");
  const ms = workCardOf("ms.mail.create_draft", { connectionId: "con_2", to: ["a@b.c"], subject: "S", text: "T" }, { draftId: "msg_9" })!;
  assert.deepEqual(ms.actions!.map((a) => [a.cap, a.input["messageId"] ?? a.input["to"]]), [["ms.mail.send_message", ["a@b.c"]], ["ms.mail.delete_message", "msg_9"]]);
  assert.equal(workCardOf("google.gmail.create_draft", {}, {}), null);
});

test("the Gmail draft shows as the held email card; Edit then Send sends the edited words and deletes the draft there", async () => {
  const w = world();
  const root = await mount(createRoot, <ProviderDraftCard card={gmailCard()} agent="Dex" agentId="agt_dex" data={w.d} editor={editor} />);
  const t = textOf(root);
  assert.match(t, /Dex wants to email josh@firm\.test/);
  assert.match(t, /Re: the lease/);
  assert.match(t, /Saved as a draft in Gmail/);
  await press(find(root, "draft-dr_1-edit"));
  await typeInto(find(root, "stub-editor")!, "Hi Josh, short version.");
  await press(find(root, "draft-dr_1-save")); await flush();
  assert.equal(w.calls.some((c) => c.cap === "google.gmail.send_message"), false, "saving sends nothing");
  await press(find(root, "draft-dr_1-send")); await flush();
  const sent = w.calls.find((c) => c.cap === "google.gmail.send_message")!.input;
  assert.deepEqual([sent.to, sent.subject, sent.text, sent.threadId, sent.connectionId], [["josh@firm.test"], "Re: the lease", "Hi Josh, short version.", "t1", "con_1"]);
  assert.ok(sent.idempotencyKey);
  assert.equal(w.calls.find((c) => c.cap === "google.gmail.delete_draft")!.input.draftId, "dr_1");
  assert.match(textOf(root), /Sent to josh@firm\.test · \d\d:\d\d/);
});

test("Don't send on a Gmail draft deletes it there, sends nothing, and gives the agent the reason", async () => {
  const w = world();
  const root = await mount(createRoot, <ProviderDraftCard card={gmailCard()} agent="Dex" agentId="agt_dex" data={w.d} />);
  await press(find(root, "draft-dr_1-drop"));
  await typeInto(find(root, "draft-dr_1-reason")!, "Wrong thread");
  await press(find(root, "draft-dr_1-drop-go")); await flush();
  assert.equal(w.calls.find((c) => c.cap === "google.gmail.delete_draft")!.input.draftId, "dr_1");
  assert.equal(w.calls.some((c) => c.cap === "google.gmail.send_message"), false);
  assert.match(w.calls.find((c) => c.cap === "chat.post")!.input.body, /Wrong thread/);
  assert.equal(w.calls.find((c) => c.cap === "memory.corrections.record")!.input.note, "Wrong thread");
  assert.match(textOf(root), /Not sent/);
});
