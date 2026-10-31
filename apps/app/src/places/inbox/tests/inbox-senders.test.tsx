// The Inbox composer's From (rc.8): every sender from comms.senders.list grouped by service, and a send names the sender picked (senderId, with the same id as the mailbox or number).
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, find, press, flush, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { ContactTab, mailInput, smsInput } from "../contacttab/index.ts";
import { sendersOf } from "../contacttab/ContactTab.tsx";
import { createContactTabSample } from "../contacttab/sample.ts";
import { northwind } from "../contactlist/sample.ts";
import { InboxDataProvider } from "../sidebar/index.ts";

installComposerForTests(Composer);

test("comms.senders.list rows become the From list; a usable flag that is missing means usable", () => {
  const list = sendersOf({ senders: [{ id: "mbx_1", channel: "email", name: "", address: "a@x.test", via: "Gmail", provider: "gmail", default: true, usable: true }, { id: "num_1", channel: "text", name: "Main", address: "+1", via: "Twilio", usable: false, why: "Number not verified" }] });
  assert.deepEqual(list, [
    { id: "mbx_1", channel: "email", name: "a@x.test", address: "a@x.test", via: "Gmail", provider: "gmail", default: true, usable: true },
    { id: "num_1", channel: "text", name: "Main", address: "+1", via: "Twilio", usable: false, why: "Number not verified" },
  ]);
});

test("a send from a picked sender names it: senderId and the mailbox or number id are the same", () => {
  const conv = { contactId: "ct_1", address: "e@x.test", displayName: "E" } as never;
  const d = { chan: "email", from: { email: "mbx_2", sms: null }, to: ["e@x.test"], cc: [], bcc: [], subject: "Hi", text: "Hello", draftId: null } as never;
  const mail = mailInput(d, { id: "mbx_2", kind: "mailbox", address: "u@x.test", label: "Updates", isDefault: false, senderId: "mbx_2" }, conv, "k1");
  assert.equal(mail.mailboxId, "mbx_2");
  assert.equal((mail as { senderId?: string }).senderId, "mbx_2");
  const sms = smsInput(d, { id: "num_1", kind: "number", address: "+1", label: "Main", isDefault: true, senderId: "num_1" }, conv, "+2", "k2");
  assert.equal((sms as { senderId?: string }).senderId, "num_1");
  const plain = mailInput(d, { id: "mbx_2", kind: "mailbox", address: "u@x.test", label: "Updates", isDefault: false }, conv, "k1");
  assert.equal("senderId" in plain, false, "an older server's inbox list sends as before");
});

test("screen: From lists every sender grouped by service; picking one and pressing Cmd+Enter sends the email from it", async () => {
  const restore = installDom();
  try {
    const s = createContactTabSample(northwind);
    const root = await mount(createRoot, <InboxDataProvider value={s.data}><ContactTab conversationId="elena" contactId="ct_elena" /></InboxDataProvider>);
    await flush();
    await press(find(root, "from-pick"));
    const menu = textOf(find(root, "from-menu"));
    assert.ok(menu.includes("Gmail") && menu.includes("hello@northwind.example") && menu.includes("support@"), menu);
    await press(find(root, "row-from-mbx_hello"));
    assert.match(textOf(find(root, "from-name")), /hello@/);
    const field = find(root, "composer-field") as Node;
    await typeInto(field, "Thursday works.");
    await act(async () => { (find(root, "composer-field")!.props.onKeyDown as (e: unknown) => void)({ key: "Enter", metaKey: true, nativeEvent: { key: "Enter", metaKey: true }, target: {}, stopPropagation() {}, preventDefault() {}, isDefaultPrevented: () => true }); });
    await flush();
    const sent = s.sent.find((x) => x.cap === "mail.send");
    assert.ok(sent, "sent");
    assert.deepEqual([(sent.input as { mailboxId: string }).mailboxId, (sent.input as { senderId?: string }).senderId], ["mbx_hello", "mbx_hello"]);
  } finally { restore(); }
});
