// An agent's email draft is a held email card in the chat where it was asked (lane l-chrome2a): who it goes to, the subject and the words, Edit and Send and Don't send, and nothing sent until Send.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { TextInput } from "react-native";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { DraftCard } from "./draft-card.tsx";
import { workCardOf } from "../../../../../../agent/src/tools/work-cards.ts";
import { draftOf } from "../../../../../../ui/src/blocks/link-card/state.ts";
import { linkCardOf } from "../../../../../../ui/src/blocks/link-card/model.ts";

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
