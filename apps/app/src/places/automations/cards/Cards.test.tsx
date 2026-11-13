// The cards as a person meets them. The credential card is ONE component for Ask Vyre, the Connect an app sheet and the Vault's add-item sheet: only its frame differs. What he types goes to the one
// port that writes it to the Vault; it is never in an event, a message or a line the card draws.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { AllowCard, CredentialCard, MappingCard, TestLeadCard, UnderstoodCard, WaitingCard } from "./Cards.tsx";
import type { Credential } from "./model.ts";

installDom();

const cred = (o: Partial<Credential> = {}): Credential => ({
  app: { id: "hubspot", name: "HubSpot" },
  mode: "key",
  field: "Private app token",
  guide: { steps: ["Open Settings.", "Open Private apps."], source: "HubSpot's documentation, read 13 Nov 2026" },
  frame: "chat",
  ...o,
});

function setup(c: Credential, result: "saved" | "refused" = "saved") {
  const seen: string[] = [];
  const port = {
    save: async (value: string) => {
      seen.push(`save:${value}`);
      return result;
    },
  };
  const el = (
    <CredentialCard
      credential={c}
      port={port}
      onClose={() => seen.push("close")}
      onBrowser={() => seen.push("browser")}
    />
  );
  return { seen, el };
}

test("it names where the value goes, and Save writes it through the port and collapses to one saved line", async () => {
  const { seen, el } = setup(cred());
  const root = await mount(createRoot, el);
  assert.ok(textOf(root).includes("Paste your HubSpot Private app token"));
  assert.ok(textOf(root).includes("Saved to your Vault as “HubSpot”, never typed into the chat."));
  await typeInto(find(root, "cc-field"), "tok-1");
  await press(find(root, "cc-save"));
  await flush();
  assert.deepEqual(seen, ["save:tok-1"]);
  const t = textOf(root);
  assert.ok(t.includes("Saved to your Vault as “HubSpot”"));
  assert.ok(!t.includes("tok-1"), "the value is never drawn");
  assert.equal(find(root, "cc-field"), null);
});

test("a refused key reopens the card empty with one plain line", async () => {
  const { el } = setup(cred(), "refused");
  const root = await mount(createRoot, el);
  await typeInto(find(root, "cc-field"), "bad");
  await press(find(root, "cc-save"));
  await flush();
  assert.ok(textOf(root).includes("HubSpot did not accept that token."));
  assert.equal(find(root, "cc-field")!.props["value"], "");
});

test("Show me how shows the app's own steps with their source; unread guidance says it is finding them", async () => {
  const { el } = setup(cred());
  const root = await mount(createRoot, el);
  await press(find(root, "cc-how"));
  assert.ok(textOf(root).includes("Open Private apps."));
  assert.ok(textOf(root).includes("Written from HubSpot's documentation, read 13 Nov 2026."));
  const { el: el2 } = setup(cred({ guide: null }));
  const root2 = await mount(createRoot, el2);
  await press(find(root2, "cc-how"));
  assert.ok(textOf(root2).includes("Finding how to connect HubSpot"));
  assert.ok(!textOf(root2).includes("Settings"));
});

test("closing with something typed asks Keep what you typed; Discard stores nothing and closes", async () => {
  const { seen, el } = setup(cred({ frame: "sheet" }));
  const root = await mount(createRoot, el);
  assert.ok(textOf(root).includes("Only you can use it."));
  await typeInto(find(root, "cc-field"), "half");
  await press(find(root, "cc-close"));
  assert.ok(textOf(root).includes("Keep what you typed?"));
  await press(find(root, "cc-keep"));
  assert.equal(find(root, "cc-field")!.props["value"], "half");
  await press(find(root, "cc-close"));
  await press(find(root, "cc-discard"));
  assert.deepEqual(seen, ["close"]);
});

test("I am stuck, Use my browser, I am signed in: the card never asks for a password", async () => {
  const { seen, el } = setup(cred());
  const root = await mount(createRoot, el);
  await press(find(root, "cc-stuck"));
  await press(find(root, "cc-browser"));
  assert.ok(textOf(root).includes("Type your password there. I never see it. I wait."));
  await press(find(root, "cc-signed"));
  assert.ok(textOf(root).includes("I opened the page for the key."));
  assert.deepEqual(seen, ["browser"]);
});

test("the other cards: I understood, mapping, waiting, test lead and Allow each do one defined thing", async () => {
  const calls: string[] = [];
  const u = await mount(
    createRoot,
    <UnderstoodCard
      card={{
        title: "I understood 1 thing. Is that right?",
        trigger: { app: { id: "wordpress", name: "WordPress" }, text: "When a form is submitted on WordPress" },
        items: [{ n: 1, app: null, text: "Add a row", notSure: false }],
        actions: ["Yes, that is it", "Change something"],
      }}
      onAnswer={(a) => calls.push(a)}
    />,
  );
  await press(find(u, "uc-yes"));
  await press(find(u, "uc-change"));
  const m = await mount(
    createRoot,
    <MappingCard
      card={{
        title: "How the form fills the lead in HubSpot",
        app: { id: "hubspot", name: "HubSpot" },
        rows: [
          { from: "Name", to: "Name" },
          { from: "Preferred time", to: null },
        ],
        line: "Nothing in HubSpot takes “Preferred time”.",
        choices: [
          { id: "notes", label: "Put it in Notes" },
          { id: "skip", label: "Leave it out" },
        ],
        actions: [],
      }}
      onChoose={(id) => calls.push(`map:${id}`)}
    />,
  );
  await press(find(m, "mc-notes"));
  const w = await mount(
    createRoot,
    <WaitingCard
      card={{
        title: "Waiting for the first real submission",
        app: { id: "wordpress", name: "WordPress" },
        url: "https://x.example/h",
        note: "I remind you once after 24 hours.",
        actions: ["Check now"],
      }}
      onCheck={() => calls.push("check")}
    />,
  );
  await press(find(w, "wc-check"));
  const t = await mount(
    createRoot,
    <TestLeadCard
      card={{
        title: "Try it with a test lead?",
        app: { id: "hubspot", name: "HubSpot" },
        line: "x",
        actions: ["Create, then remove", "Skip"],
        write: true,
      }}
      onAnswer={(a) => calls.push(`lead:${a}`)}
    />,
  );
  await press(find(t, "tl-create"));
  await press(find(t, "tl-skip"));
  const a = await mount(
    createRoot,
    <AllowCard
      card={{
        title: "Let Assistant use Google Workspace for this Automation?",
        line: "y",
        actions: ["Allow", "Not now"],
      }}
      onAnswer={(r) => calls.push(`allow:${r}`)}
    />,
  );
  await press(find(a, "al-allow"));
  assert.deepEqual(calls, ["yes", "change", "map:notes", "check", "lead:run", "lead:skip", "allow:yes"]);
});
