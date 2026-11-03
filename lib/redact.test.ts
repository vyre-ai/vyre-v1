// Redaction for AI, the pure part: what an agent reads, the detectors (no model), and carrying marks to a new version.
import test from "node:test";
import assert from "node:assert/strict";
import { REDACTED, agentBound, agentName, builtFromNames, classify, detect, reanchor, renderForAgent, scrubAll, scrubDeep, type Mark } from "./redact.ts";

const red = (text: string, o: Partial<Mark> = {}): Mark => ({ id: `m${Math.random()}`, kind: "redact", shape: "span", text, ...o });
const hl = (text: string, o: Partial<Mark> = {}): Mark => ({ id: `h${Math.random()}`, kind: "highlight", shape: "span", text, ...o });

test("an agent reads the literal [REDACTED] for every redaction, highlights as ==marks==, and nothing else changes", () => {
  const t = "Elena Rivera called on Oct 22. Her number is (415) 555-0161. Elena Rivera prefers afternoons.";
  assert.equal(renderForAgent(t, [red("Elena Rivera"), red("(415) 555-0161")]), `${REDACTED} called on Oct 22. Her number is ${REDACTED}. ${REDACTED} prefers afternoons.`);
  assert.equal(renderForAgent(t, [red("Elena Rivera", { occurrence: 1 })]), `Elena Rivera called on Oct 22. Her number is (415) 555-0161. ${REDACTED} prefers afternoons.`);
  assert.equal(renderForAgent(t, [hl("prefers afternoons")]), "Elena Rivera called on Oct 22. Her number is (415) 555-0161. Elena Rivera ==prefers afternoons==.");
  assert.equal(renderForAgent(t, [hl("prefers afternoons")], { highlights: false }), t, "a code file reads without highlight marks");
  assert.equal(renderForAgent(t, []), t);
});

test("a redaction inside a highlight keeps the hatch over the tint: ==...[REDACTED]...==; touching redactions read as one", () => {
  const t = "diagnosed with a torn meniscus in her right knee and a sprained wrist";
  assert.equal(renderForAgent(t, [hl("diagnosed with a torn meniscus in her right knee"), red("torn meniscus")]), `==diagnosed with a ${REDACTED} in her right knee== and a sprained wrist`);
  assert.equal(renderForAgent("AB", [red("A"), red("B")]), REDACTED);
  assert.equal(renderForAgent("x A y", [red("A"), red("A y")]), `x ${REDACTED}`);
});

test("a chosen match that is gone falls back to every match: a redaction never fails open", () => {
  assert.equal(renderForAgent("one Rivera two", [red("Rivera", { occurrence: 5 })]), `one ${REDACTED} two`);
});

test("scrubAll and scrubDeep hide every match in snippets, cells and paths, longest first", () => {
  assert.equal(scrubAll("Elena Rivera and Rivera", ["Rivera", "Elena Rivera"]), `${REDACTED} and ${REDACTED}`);
  assert.deepEqual(scrubDeep({ rows: [["Elena Rivera", 12]], note: "SSN 512-44-8391" }, ["Elena Rivera", "512-44-8391"]), { rows: [[REDACTED, 12]], note: `SSN ${REDACTED}` });
  assert.equal(agentName("Rivera retainer.pdf", [{ id: "n", kind: "redact", shape: "name", text: "Rivera" }]), `${REDACTED} retainer.pdf`);
});

test("detectors find names from Records, SSNs, dates of birth, account and case numbers, phones, emails and addresses, once each, with counts", () => {
  const t = [
    "Name: Elena Rivera. Date of birth: 03/14/1986. SSN: 512-44-8391. Born March 14, 1986.",
    "Phone: (415) 555-0161, spouse 415-555-0178. Email: elena.rivera@fastmail.example.",
    "Address: 2217 Alder Street, Apt 4, Oakland. Matter CV-2026-04417. Trust account 4471-0098-2216. Kaiser KP-88213-0475. MRN 00-4471882.",
    "Fell on September 28, 2026. Elena Rivera signed.",
  ].join("\n");
  const s = detect(t, { names: ["Elena Rivera", "Dana Alvarez"] });
  const by = (k: string) => s.filter((x) => x.kind === k).map((x) => x.text);
  assert.deepEqual(by("name"), ["Elena Rivera"]);
  assert.equal(s.find((x) => x.text === "Elena Rivera")!.count, 2);
  assert.deepEqual(by("ssn"), ["512-44-8391"]);
  assert.deepEqual(by("dob"), ["03/14/1986", "March 14, 1986"], "a date this year is not a date of birth");
  assert.deepEqual(by("account").sort(), ["00-4471882", "4471-0098-2216", "CV-2026-04417", "KP-88213-0475"]);
  assert.deepEqual(by("phone"), ["(415) 555-0161", "415-555-0178"]);
  assert.deepEqual(by("email"), ["elena.rivera@fastmail.example"]);
  assert.deepEqual(by("address"), ["2217 Alder Street, Apt 4"]);
  assert.deepEqual(detect(t, { names: ["Elena Rivera"], skip: ["Elena Rivera", "512-44-8391"] }).map((x) => x.text).filter((x) => x === "Elena Rivera" || x === "512-44-8391"), [], "already redacted text is not suggested again");
  assert.equal(classify("512-44-8391"), "SSN");
  assert.equal(classify("Elena Rivera", ["Elena Rivera"]), "Name");
  assert.equal(classify("prefers afternoons"), "Text");
});

test("detectors suggest an email, handle or user name built from a name, so hiding the name does not leave it given away", () => {
  const t = [
    "Name: Elena Rivera. Email: elena.rivera@fastmail.example. Work: erivera@northwind.example.",
    "Instagram @elenarivera86, portal user rivera_e, profile linkedin.com/in/elena-rivera.",
    "Rivera's spouse lives in Riverside. Contact desk@clinic.example. Elena signed.",
    "Spouse: Marco Rivera. Referred by: Maya Chen. Signed Elena Rivera.",
  ].join("\n");
  const built = builtFromNames(t, ["Elena Rivera"]);
  assert.deepEqual(built.map((x) => [x.text, x.kind]), [
    ["elena.rivera@fastmail.example", "email"], ["erivera@northwind.example", "email"], ["elenarivera86", "name"], ["rivera_e", "name"], ["linkedin.com/in/elena-rivera", "name"],
    ["Marco Rivera", "name"],
  ], "the bare name, Rivera's, Riverside, an email with no name in it, another name and words around the name itself are not built from the name");
  assert.equal(built.at(-1)!.label, "Shares a name");
  assert.equal(built[0]!.label, "Email with a name in it");
  // through detect: suggested beside the name, before the plain email rule, once each
  const s = detect(t, { names: ["Elena Rivera"], skip: ["Elena Rivera"] });
  assert.equal(s.filter((x) => x.text === "elena.rivera@fastmail.example").length, 1);
  assert.equal(s.find((x) => x.text === "elena.rivera@fastmail.example")!.label, "Email with a name in it");
  assert.equal(s.find((x) => x.text === "desk@clinic.example")!.label, "Email", "an email with no name in it is still an email");
  assert.ok(s.some((x) => x.text === "rivera_e"));
  assert.deepEqual(builtFromNames(t, []), [], "no names, nothing built from one");
  assert.deepEqual(detect(t, { names: ["Elena Rivera"], skip: ["Elena Rivera", "elena.rivera@fastmail.example"] }).filter((x) => x.text === "elena.rivera@fastmail.example"), [], "a redacted email is not suggested again");
});

test("re-anchoring: a mark follows its text to the new version, a chosen match moves to where its surroundings fit, a vanished text is unplaced", () => {
  const v1 = "Patient: Elena Rivera. DOB 03/14/1986. Phone (415) 555-0161. Therapist Amara Okafor saw Elena Rivera weekly.";
  const v2 = "Progress notes, version 3.\nPatient: Elena Rivera. Born March 14, 1986. Therapist Amara Okafor saw Elena Rivera weekly.";
  const marks = [red("Elena Rivera"), red("03/14/1986"), red("(415) 555-0161"), red("Elena Rivera", { occurrence: 1 }), hl("weekly"), { id: "b", kind: "redact", shape: "box", box: { x: 0, y: 0, w: 0.1, h: 0.1 } } as Mark];
  const { placed, unplaced } = reanchor(v1, v2, marks);
  assert.deepEqual(unplaced.map((m) => m.text ?? "box"), ["03/14/1986", "(415) 555-0161", "box"], "the date changed form, the phone is gone, a box on a new picture cannot be placed");
  assert.equal(placed.find((m) => m.occurrence === 1)?.text, "Elena Rivera", "the second Elena Rivera is still the second");
  assert.equal(renderForAgent(v2, placed), `Progress notes, version 3.\nPatient: ${REDACTED}. Born March 14, 1986. Therapist Amara Okafor saw ${REDACTED} ==weekly==.`);
});

test("who counts as an agent for the read gate", () => {
  assert.equal(agentBound({ principal: { kind: "person" }, origin: "api" }), false, "a person on their own screen");
  assert.equal(agentBound({ principal: { kind: "agent" } }), true);
  assert.equal(agentBound({ principal: { kind: "actor" } }), true, "an outside API actor may be an AI");
  assert.equal(agentBound({ principal: { kind: "person" }, origin: "engine" }), true, "the engine reads context as the person");
  assert.equal(agentBound({ principal: { kind: "person" }, origin: "mcp" }), true, "a setup-grant call reruns as the person at the MCP door");
  assert.equal(agentBound({ principal: { kind: "person" }, origin: "api", forAgent: "agt_x" }), true);
  assert.equal(agentBound({ principal: { kind: "service" }, origin: "computers" }), true, "the agent's computer");
});
