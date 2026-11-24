import test from "node:test";
import assert from "node:assert/strict";
import { registrationDraft, registrationInput, registrationMissing, hoursProblem, subjectLabel } from "./model.ts";
test("Saved texting registration hydrates all submission details and preserves them through save input", () => {
  const saved = {
    id: "reg_fixture",
    state: "draft" as const,
    legalName: "Fixture LLC",
    ein: "12-3456789",
    website: "https://fixture.example",
    contactName: "Fixture Operator",
    contactEmail: "operator@fixture.example",
    useCase: "Support replies",
    optInDescription: "Customer checkbox",
    sampleMessages: ["Fixture support reply"],
    address: { line1: "123 Fixture Street", city: "New York", region: "NY", postal: "10001", country: "US" },
  };
  const draft = registrationDraft(saved);
  assert.deepEqual(registrationMissing(draft), []);
  assert.deepEqual(registrationInput(draft), {
    legalName: saved.legalName,
    ein: saved.ein,
    website: saved.website,
    contactName: saved.contactName,
    contactEmail: saved.contactEmail,
    useCase: saved.useCase,
    optInDescription: saved.optInDescription,
    sampleMessages: saved.sampleMessages,
    address: saved.address,
  });
  assert.ok(registrationMissing(registrationDraft()).includes("Business address"));
});
test("Call hours preserve multiple windows and reject invalid schedules before mutation", () => {
  assert.equal(
    hoursProblem({
      zone: "America/New_York",
      outsideHours: "voicemail",
      weekly: [
        { day: 1, start: "09:00", end: "12:00" },
        { day: 1, start: "13:00", end: "17:00" },
      ],
    }),
    "",
  );
  assert.match(
    hoursProblem({ zone: "UTC", outsideHours: "voicemail", weekly: [{ day: 1, start: "17:00", end: "09:00" }] }),
    /after/,
  );
  assert.match(hoursProblem({ zone: "Not/AZone", outsideHours: "ring", weekly: [] }), /time zone/);
});
test("Recipient fallback never prints a raw identity or mailbox id", () => {
  assert.equal(subjectLabel({ kind: "person", id: "usr_fixture", name: "usr_fixture" }), "Person");
  assert.equal(subjectLabel({ kind: "person", id: "usr_fixture", name: "Maya" }), "Maya");
});

test("a screen several Console pages draw has its own page named, and a link to the screen alone opens it whatever order the sidebar lists the pages in", async () => {
  const { PAGES, PRIMARY_PAGE, pageOfScreen } = await import("../../shell/nav.ts");
  const { adminTarget } = await import("../../../shell/providers/settings-admin.ts");
  const bySize = new Map<string, string[]>();
  for (const p of PAGES) bySize.set(p.screen, [...(bySize.get(p.screen) ?? []), p.id]);
  for (const [screen, ids] of bySize) {
    if (ids.length < 2) continue;
    const own = PRIMARY_PAGE[screen];
    assert.ok(own, `${screen} is drawn by ${ids.join(", ")}: name its own page in PRIMARY_PAGE`);
    assert.ok(ids.includes(own!), `${screen}'s own page ${own} draws it`);
    assert.equal(pageOfScreen(screen)?.id, own);
    assert.equal(
      pageOfScreen(screen, [...PAGES].reverse())?.id,
      own,
      `${screen}: the order of the pages changes nothing`,
    );
  }
  for (const screen of Object.keys(PRIMARY_PAGE)) assert.ok(bySize.has(screen), `${screen} is a real screen`);
  // the Apps link to add a sending domain, and the deep link to one domain, name the page
  assert.equal(adminTarget("mail.domains", { create: "true" }).args["page"], "domains");
  assert.equal(adminTarget("mail.domains", { domainId: "dom_1" }).args["page"], "domains");
  // the Email page keeps the head of the Comms group and is reached by its own name
  const comms = PAGES.filter((p) => p.group === "Comms").map((p) => p.id);
  assert.equal(comms[0], "email");
  assert.ok(comms.includes("domains"));
});
