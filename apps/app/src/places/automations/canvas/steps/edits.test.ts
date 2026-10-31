import test from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLE_SCHEMA, answerKindOf, authOf, bodyKindOf, headerProblem, hostsOf, joinHandle, pairsOf, recordOf, setAnswerKind, setAuth, setBodyKind, setHosts, setJsonBody, setMethod, setSchemaText, setTimeoutMinutes,
  sameKeySteps, splitHandle, typedText, withAi, withField,
} from "./edits.ts";

test("rows become a record: blanks go, the last same name wins, no rows removes the key, and typed values stay typed", () => {
  assert.deepEqual(recordOf([{ key: "page", value: "2" }, { key: " ", value: "x" }, { key: "tag", value: "a" }, { key: "tag", value: "b" }], false), { page: "2", tag: "b" });
  assert.deepEqual(recordOf([{ key: "n", value: "2" }, { key: "on", value: "true" }, { key: "t", value: "{{ trigger.x }}" }, { key: "o", value: '{"a":1}' }], true), { n: 2, on: true, t: "{{ trigger.x }}", o: { a: 1 } });
  assert.equal(recordOf([], false), undefined);
  assert.equal(recordOf([{ key: "", value: "x" }], true), undefined);
  assert.deepEqual(pairsOf({ a: "1", b: 2, c: { d: 1 } }), [{ key: "a", value: "1" }, { key: "b", value: "2" }, { key: "c", value: '{"d":1}' }]);
  assert.deepEqual(pairsOf(undefined), []);
  assert.equal(typedText("12abc"), "12abc");
  assert.equal(typedText("{ broken"), "{ broken");
});

test("choosing GET or HEAD takes the body away; a send keeps it", () => {
  const post = { method: "POST", url: "https://a.example/x", json: { a: 1 } };
  assert.deepEqual(setMethod(post, "PUT"), { method: "PUT", url: "https://a.example/x", json: { a: 1 } });
  assert.deepEqual(setMethod(post, "GET"), { method: "GET", url: "https://a.example/x" });
  assert.deepEqual(setMethod({ method: "POST", text: "hi" }, "HEAD"), { method: "HEAD" });
});

test("the body is none, JSON or text; switching clears the other, and JSON is checked as it is typed", () => {
  assert.equal(bodyKindOf({}), "none");
  assert.equal(bodyKindOf({ json: {} }), "json");
  assert.equal(bodyKindOf({ text: "" }), "text");
  assert.deepEqual(setBodyKind({ json: { a: 1 } }, "text"), { text: "" });
  assert.deepEqual(setBodyKind({ text: "x" }, "json"), { json: {} });
  assert.deepEqual(setBodyKind({ json: { a: 1 } }, "json"), { json: { a: 1 } });
  assert.deepEqual(setBodyKind({ json: { a: 1 }, url: "u" }, "none"), { url: "u" });
  assert.deepEqual(setJsonBody({}, '{"sku":"A"}'), { ok: true, value: { json: { sku: "A" } } });
  assert.deepEqual(setJsonBody({}, "{ nope"), { ok: false, message: "The body is not valid JSON yet." });
  assert.deepEqual(setJsonBody({ json: { a: 1 } }, "  "), { ok: true, value: { json: {} } });
});

test("a header that would carry a key, or that the step owns, is refused with the reason", () => {
  assert.match(headerProblem("Authorization")!, /Pick the key under Authentication/);
  assert.match(headerProblem("X-Api-Key")!, /Authentication/);
  assert.match(headerProblem("Cookie")!, /Authentication/);
  assert.match(headerProblem("Host")!, /set by the step/);
  assert.match(headerProblem("Content-Length")!, /set by the step/);
  assert.match(headerProblem("bad name")!, /not a header name/);
  assert.equal(headerProblem("X-Request-Source"), null);
  assert.equal(headerProblem("Accept"), null);
  assert.equal(headerProblem(""), null);
});

test("authentication writes only the parts its kind uses, names the key by handle, and None removes it", () => {
  const base = { method: "GET", url: "https://a.example" };
  assert.deepEqual(authOf(base), { kind: "none", handle: "", username: "", header: "" });
  const bearer = setAuth(base, { kind: "bearer", handle: "#Acme_API.api_key", username: "ignored", header: "ignored" });
  assert.deepEqual(bearer["auth"], { kind: "bearer", handle: "#Acme_API.api_key" });
  assert.deepEqual(setAuth(base, { kind: "basic", handle: "#Acme", username: "dana", header: "x" })["auth"], { kind: "basic", handle: "#Acme", username: "dana" });
  assert.deepEqual(setAuth(base, { kind: "header", handle: "#Acme", username: "u", header: "x-api-key" })["auth"], { kind: "header", handle: "#Acme", header: "x-api-key" });
  assert.deepEqual(authOf(bearer), { kind: "bearer", handle: "#Acme_API.api_key", username: "", header: "" });
  assert.equal("auth" in setAuth(bearer, { kind: "none", handle: "", username: "", header: "" }), false);
  assert.deepEqual(splitHandle("#Acme_API.api_key"), { item: "#Acme_API", field: "api_key" });
  assert.deepEqual(splitHandle("#Acme_API"), { item: "#Acme_API", field: "" });
  assert.equal(joinHandle("#Acme_API", " api_key "), "#Acme_API.api_key");
  assert.equal(joinHandle("#Acme_API", ""), "#Acme_API");
  assert.equal(joinHandle("", "api_key"), "");
});

test("hosts: one per line or comma, lower case, no repeats, and a bad name is named back", () => {
  assert.deepEqual(setHosts({}, "API.example.com\n*.cdn.example.com, api.example.com"), { ok: true, value: { hosts: ["api.example.com", "*.cdn.example.com"] } });
  assert.deepEqual(setHosts({ hosts: ["a.example.com"] }, ""), { ok: true, value: {} });
  assert.deepEqual(setHosts({}, "10.0.0.1"), { ok: false, message: "10.0.0.1 is not a host name. Use api.example.com or *.example.com." });
  assert.equal(setHosts({}, "localhost").ok, false);
  assert.equal(setHosts({}, Array.from({ length: 11 }, (_, i) => `h${i}.example.com`).join("\n")).ok, false);
  assert.deepEqual(hostsOf({ hosts: ["a.example.com", 3] }), ["a.example.com"]);
  assert.deepEqual(hostsOf({}), []);
});

test("the AI step's own settings: timeout in minutes, answer kind and the JSON shape", () => {
  assert.deepEqual(setTimeoutMinutes({}, "10"), { ok: true, value: { timeoutMinutes: 10 } });
  assert.deepEqual(setTimeoutMinutes({ timeoutMinutes: 10 }, ""), { ok: true, value: {} });
  for (const bad of ["0", "31", "2.5", "abc"]) assert.equal(setTimeoutMinutes({}, bad).ok, false, bad);
  assert.equal(answerKindOf({}), "text");
  assert.equal(answerKindOf({ outputSchema: {} }), "json");
  assert.deepEqual(setAnswerKind({ prompt: "p" }, "json"), { prompt: "p", outputSchema: EXAMPLE_SCHEMA });
  assert.deepEqual(setAnswerKind({ prompt: "p", outputSchema: { type: "array" } }, "json"), { prompt: "p", outputSchema: { type: "array" } });
  assert.deepEqual(setAnswerKind({ prompt: "p", outputSchema: { type: "array" } }, "text"), { prompt: "p" });
  assert.deepEqual(setSchemaText({}, '{"type":"object"}'), { ok: true, value: { outputSchema: { type: "object" } } });
  assert.equal(setSchemaText({}, "{ nope").ok, false);
  assert.equal(setSchemaText({}, "[1]").ok, false);
  assert.match((setSchemaText({}, '{"title":"x"}') as { message: string }).message, /needs a "type"/);
  assert.deepEqual(withAi({ keyId: "#K" }, "reviewer", { kind: "person", id: "usr_a" }), { keyId: "#K", reviewer: { kind: "person", id: "usr_a" } });
  assert.deepEqual(withAi({ keyId: "#K", reviewer: { kind: "person", id: "usr_a" } }, "reviewer", undefined), { keyId: "#K" });
  assert.deepEqual(withField({ a: 1 }, "a", undefined), {});
});

test("the other steps that sign with the same Vault item are named by title, or by kind without one", () => {
  const nodes = [
    { id: "a", key: "http_request", input: { auth: { kind: "bearer", handle: "#Acme_API.api_key" } } },
    { id: "b", key: "http_request", title: "Read invoices", input: { auth: { kind: "bearer", handle: "#Acme_API" } } },
    { id: "c", key: "http_request", input: { auth: { kind: "bearer", handle: "#Other" } } },
    { id: "d", key: "http_request", input: {} },
  ];
  assert.deepEqual(sameKeySteps(nodes, "a", "#Acme_API"), ["Read invoices"]);
  assert.deepEqual(sameKeySteps(nodes, "b", "#Acme_API"), ["http_request"]);
  assert.deepEqual(sameKeySteps(nodes, "a", ""), []);
});

// ---- the agent task kind (work baton, lane W2)
import { validate as validateAgainst } from "../../../../../../../packages/contracts/src/jsonschema.ts";
import { doneMeansText, fieldsOf, modeOf, schemaFromFields, setDoneMeans, setMode, setNudgeMinutes, setTimeLimit } from "./edits.ts";

test("the mode is Answer unless the step says Task, and switching back leaves no mode behind", () => {
  assert.equal(modeOf(undefined), "answer");
  assert.equal(modeOf(setMode({ agentId: "a" }, "task")), "task");
  assert.deepEqual(setMode({ agentId: "a", mode: "task" }, "answer"), { agentId: "a" });
});

test("done means is one check per line; bullets and blanks are dropped; none leaves the field out", () => {
  assert.deepEqual(setDoneMeans({}, "- Names the client\n\n• States the fee\n  third  ").doneMeans, ["Names the client", "States the fee", "third"]);
  assert.equal(doneMeansText({ doneMeans: ["a", "b"] }), "a\nb");
  assert.equal("doneMeans" in setDoneMeans({ doneMeans: ["a"] }, "  \n"), false);
});

test("a task's time limit runs to a day and the nudge to a day; both refuse what is not whole minutes", () => {
  assert.equal(setTimeLimit({}, "90", 1440).ok, true);
  assert.deepEqual(setTimeLimit({}, "1441", 1440), { ok: false, message: "Minutes is a whole number from 1 to 1440." });
  assert.equal(setTimeLimit({ timeoutMinutes: 5 }, "", 1440).ok && "timeoutMinutes" in (setTimeLimit({ timeoutMinutes: 5 }, "", 1440) as { value: object }).value, false);
  assert.equal(setNudgeMinutes({}, "10").ok, true);
  assert.equal(setNudgeMinutes({}, "0").ok, false);
  assert.equal(setNudgeMinutes({}, "soon").ok, false);
});

test("the deliverable is a list of fields and back: every named field is required, an unknown type is text, and a deeper shape is not a field list", () => {
  const schema = schemaFromFields([{ key: "letter", value: "text" }, { key: "pages", value: "Whole Number" }, { key: "ok", value: "mystery" }, { key: "  ", value: "text" }])!;
  assert.deepEqual(schema, { type: "object", required: ["letter", "pages", "ok"], properties: { letter: { type: "string" }, pages: { type: "integer" }, ok: { type: "string" } } });
  assert.deepEqual(fieldsOf(schema), [{ key: "letter", value: "text" }, { key: "pages", value: "whole number" }, { key: "ok", value: "text" }]);
  const typed = schemaFromFields([{ key: "due", value: "date" }, { key: "agree", value: "yes/no" }, { key: "tags", value: "list" }, { key: "matter", value: "record link" }])!;
  assert.deepEqual(fieldsOf(typed)!.map((p) => p.value), ["date", "yes/no", "list", "record link"], "every picker type comes back as itself");
  assert.deepEqual(validateAgainst(typed, { due: "2026-11-02", agree: true, tags: ["a"], matter: "rec_a1" }), []);
  assert.notDeepEqual(validateAgainst(typed, { due: "soon", agree: true, tags: ["a"], matter: "rec_a1" }), [], "a date is a date");
  assert.notDeepEqual(validateAgainst(typed, { due: "2026-11-02", agree: true, tags: ["a"], matter: "Smith" }), [], "a record link is a record id");
  assert.equal(schemaFromFields([]), undefined);
  assert.deepEqual(fieldsOf(undefined), []);
  assert.equal(fieldsOf({ type: "object", properties: { a: { type: "object" } } }), null);
  assert.equal(fieldsOf({ type: "object", required: [], properties: { a: { type: "string" } } }), null, "an optional field is not a plain list");
  assert.equal(fieldsOf({ type: "array" }), null);
});

import { addChip, chipLabel, dropChip, joinTemplate, splitTemplate } from "./edits.ts";

test("a template is text and data chips, and goes back to the same string", () => {
  const t = "Draft the letter for {{ trigger.name }} using {{steps.find.out.rows}}, then stop.";
  const segs = splitTemplate(t);
  assert.deepEqual(segs.map((s) => (s.kind === "text" ? s.text : `<${s.ref}>`)), ["Draft the letter for ", "<trigger.name>", " using ", "<steps.find.out.rows>", ", then stop."]);
  assert.equal(joinTemplate(segs), "Draft the letter for {{ trigger.name }} using {{ steps.find.out.rows }}, then stop.");
  assert.deepEqual(splitTemplate(""), [{ kind: "text", text: "" }]);
  assert.equal(joinTemplate(splitTemplate("no data here")), "no data here");
});

test("chips say what they bring in, by the step's name, and dropping one joins the text around it", () => {
  const title = (id: string): string => (id === "find" ? "Find rows" : id);
  assert.equal(chipLabel("trigger", title), "What started the run");
  assert.equal(chipLabel("trigger.name", title), "Started with name");
  assert.equal(chipLabel("steps.find.out", title), "Find rows");
  assert.equal(chipLabel("steps.find.out.count", title), "Find rows: count");
  assert.equal(chipLabel("vars.x", title), "vars.x");
  assert.equal(joinTemplate(dropChip(splitTemplate("a {{ trigger }} b"), 1)), "a  b");
  assert.equal(addChip("Draft it", "trigger"), "Draft it {{ trigger }}");
  assert.equal(addChip("", "trigger"), "{{ trigger }}");
});
