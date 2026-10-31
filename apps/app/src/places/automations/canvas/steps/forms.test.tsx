// The panels of the HTTP request, Run code and AI steps, rendered the way the place renders them (react-dom/server over react-native-web, ruling 28). Each control the form shows is named by a test id and carries the
// value the definition holds; what each control writes is proved in edits.test.ts, which every control calls.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector } from "../Inspector.tsx";
import { AutomationsDataProvider } from "../data.tsx";
import { check, layout } from "../model.ts";
import type { DefNode, Definition, KeyChoice } from "../model.ts";
import { createSampleAutomations, northwind } from "../../sidebar/sample.ts";

const keys: KeyChoice[] = [
  { id: "prv_claude", name: "Your Claude sign-in", kind: "subscription", shared: false },
  { id: "prv_team", name: "Team OpenAI key", kind: "api", shared: true },
  { id: "prv_mine", name: "My OpenAI key", kind: "api", shared: false },
];
const data = createSampleAutomations(northwind).data;

function panel(node: DefNode, kind: "personal" | "space" = "personal", def?: Definition): string {
  const d: Definition = def ?? { triggers: [{ key: "manual" }], nodes: [node] };
  return renderToStaticMarkup(
    <AutomationsDataProvider value={data}>
      <Inspector def={d} node={node} trigger={null} triggerIndex={null} issues={check(d, kind)} keys={keys} kind={kind} onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined} />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
}
const has = (out: string, needle: string): boolean => out.includes(needle);
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const value = (out: string, id: string): string => tag(out, id).match(/value="([^"]*)"/)?.[1]?.replaceAll("&quot;", '"').replaceAll("&amp;", "&") ?? "";
const noDash = (out: string): void => assert.equal(has(out, String.fromCharCode(0x2014)) || has(out, String.fromCharCode(0xa7)), false, "no em dash or section sign in any copy");

test("HTTP request, a read: method, address, query, headers and authentication; no body for a GET", () => {
  const node: DefNode = { id: "get", key: "http_request", input: { method: "GET", url: "https://api.example.com/v1/items", query: { page: "2" }, headers: { accept: "application/json" }, auth: { kind: "bearer", handle: "#Acme_API.api_key" } } };
  const out = panel(node);
  for (const id of ["field-method", "field-url", "rows-query", "rows-headers", "choose-auth", "choose-vault-key", "http-send-note", "auth-note", "http-address-note"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.equal(value(out, "field-url"), "https://api.example.com/v1/items");
  assert.equal(value(out, "rows-query-key-0"), "page");
  assert.equal(value(out, "rows-query-value-0"), "2");
  assert.equal(value(out, "rows-headers-key-0"), "accept");
  assert.match(tag(out, "field-method"), /aria-label="Method: GET"/);
  assert.equal(has(out, 'data-testid="choose-body"'), false, "a GET has no body");
  assert.match(tag(out, "choose-auth"), /aria-label="Sign the request with: Bearer token"/);
  assert.match(tag(out, "choose-vault-key"), /aria-label="Vault key: #Acme_API"/, "an item that has not loaded is still named by its handle");
  assert.ok(has(out, "A read goes out every time the step runs"));
  assert.equal(has(out, "#Acme_API.api_key"), false, "the field part of the handle is not shown as a secret-looking value");
  noDash(out);
});

test("HTTP request, a send: the body kind, a JSON body, the approval note and the user name of a basic sign-in", () => {
  const post: DefNode = { id: "post", key: "http_request", input: { method: "POST", url: "https://api.example.com/orders", json: { sku: "A-1", qty: 2 }, auth: { kind: "basic", handle: "#Acme", username: "dana" } } };
  const out = panel(post);
  assert.match(tag(out, "choose-body"), /aria-label="Body: JSON"/);
  assert.ok(has(out, 'data-testid="field-json-body"'));
  assert.ok(has(out, "&quot;sku&quot;: &quot;A-1&quot;"));
  assert.equal(value(out, "field-auth-user"), "dana");
  assert.ok(has(out, "A send is only recorded, not sent, in a test."));
  assert.ok(has(out, "Idempotency-Key"));
  const text = panel({ id: "t", key: "http_request", input: { method: "PUT", url: "https://a.example.com", text: "hello" } });
  assert.match(tag(text, "choose-body"), /aria-label="Body: Text"/);
  assert.ok(has(text, 'data-testid="field-text-body"'));
  const none = panel({ id: "n", key: "http_request", input: { method: "DELETE", url: "https://a.example.com" } });
  assert.match(tag(none, "choose-body"), /aria-label="Body: No body"/);
  const header = panel({ id: "h", key: "http_request", input: { method: "GET", url: "https://a.example.com", auth: { kind: "header", handle: "#K", header: "x-api-key" } } });
  assert.equal(value(header, "field-auth-header"), "x-api-key");
  assert.equal(has(panel({ id: "g", key: "http_request", input: { method: "GET", url: "https://a.example.com" } }), 'data-testid="choose-vault-key"'), false, "no key is asked for until the request is signed");
});

test("a request with no address, a plain http address or a half-made sign-in is named on the step", () => {
  assert.ok(has(panel({ id: "a", key: "http_request", input: { method: "GET" } }), "HTTP request needs the address"));
  assert.ok(has(panel({ id: "a", key: "http_request", input: { method: "GET", url: "http://x.example.com" } }), "the address must start with https://"));
  assert.ok(has(panel({ id: "a", key: "http_request", input: { method: "GET", url: "https://x.example.com", auth: { kind: "bearer", handle: "" } } }), "pick the Vault key to sign the request with"));
});

test("Run code: the code, its input, the hosts it may reach and the limits it runs under", () => {
  const out = panel({ id: "c", key: "code", input: { language: "javascript", source: "return { n: input.n + 1 };", input: { n: 2 }, hosts: ["api.example.com", "*.cdn.example.com"] } });
  for (const id of ["field-source", "rows-input", "field-hosts", "code-contract", "code-network", "code-limits"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, "return { n: input.n + 1 };"));
  assert.equal(value(out, "rows-input-key-0"), "n");
  assert.equal(value(out, "rows-input-value-0"), "2");
  assert.ok(has(out, "api.example.com\n*.cdn.example.com") || has(out, "api.example.com&#10;*.cdn.example.com"), "one host per line");
  assert.ok(has(out, "fetch reaches api.example.com, *.cdn.example.com and nothing else."));
  assert.ok(has(out, "10 seconds of processor time, 128 MB of memory and 1 MB of output"));
  const quiet = panel({ id: "c", key: "code", input: { source: "return 1" } });
  assert.ok(has(quiet, "No network. Name a host to let fetch reach it"));
  noDash(out);
});

test("the AI step: prompt, input data, agent, account, answer shape, reviewer, approver and timeout, with no tools", () => {
  const node: DefNode = { id: "ask", key: "ai", input: { prompt: "Score this lead", inputs: { lead: "{{ trigger.lead }}" }, outputSchema: { type: "object", required: ["score"], properties: { score: { type: "integer" } } } }, ai: { keyId: "prv_team", backupKeyId: "prv_mine", reviewer: { kind: "person", id: "usr_dana" }, timeoutMinutes: 7 } };
  const out = panel(node, "personal");
  for (const id of ["field-prompt", "rows-inputs", "choose-agent", "choose-key", "choose-backup", "choose-answer", "field-schema", "choose-reviewer", "choose-approver", "field-timeout", "ai-tools-note", "account-note", "schema-note", "review-note"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, "Score this lead"));
  assert.equal(value(out, "rows-inputs-key-0"), "lead");
  assert.match(tag(out, "choose-key"), /aria-label="Runs on: Team OpenAI key"/);
  assert.match(tag(out, "choose-backup"), /aria-label="Backup: My OpenAI key"/);
  assert.match(tag(out, "choose-answer"), /aria-label="Answer as: JSON in a shape I set"/);
  assert.match(tag(out, "choose-reviewer"), /aria-label="Reviewer: Loading\.\.\."/);
  assert.match(tag(out, "choose-approver"), /aria-label="Approver: Nobody"/);
  assert.equal(value(out, "field-timeout"), "7");
  assert.ok(has(out, "The answer waits as a task."));
  assert.ok(has(out, "The turn has no tools. It answers in words and cannot send or change anything itself."));
  noDash(out);
});

test("the AI step says whose account it runs on: a Personal one on the owner's, a Space one on a shared key it must be given", () => {
  const bare: DefNode = { id: "ask", key: "ai", input: { prompt: "Hi" } };
  const personal = panel(bare, "personal");
  assert.match(tag(personal, "choose-key"), /aria-label="Runs on: Your own AI account"/);
  assert.ok(has(personal, "A Personal automation runs on your own AI account unless you pick another."));
  assert.equal(has(personal, "needs a key shared with the Space"), false);
  const space = panel(bare, "space");
  assert.match(tag(space, "choose-key"), /aria-label="Runs on: Choose a shared key"/);
  assert.ok(has(space, "A Space automation runs as itself and can use only a key shared with the Space."));
  assert.ok(has(space, "a Space automation needs a key shared with the Space, pick one"), "the check names the missing key on the step");
  const free = panel(bare, "personal");
  assert.match(tag(free, "choose-answer"), /aria-label="Answer as: Free text"/);
  assert.equal(has(free, 'data-testid="field-schema"'), false, "no shape is asked for until the answer is JSON");
  assert.match(tag(free, "choose-agent"), /aria-label="Run as: /);
  assert.ok(has(free, "With nobody named the answer goes straight on."));
});

test("a step that is none of the three keeps the generic fields and none of their forms", () => {
  const out = panel({ id: "f", key: "records.find", input: { type: "contact" } });
  for (const id of ["field-method", "field-source", "field-prompt", "choose-auth"]) assert.equal(has(out, `data-testid="${id}"`), false, id);
  assert.ok(has(out, 'data-testid="field-type"'));
});

test("the cards say what each live step does", () => {
  const def: Definition = { triggers: [{ key: "manual" }], nodes: [
    { id: "h", key: "http_request", input: { method: "GET", url: "https://api.example.com/v1/items" }, next: ["c"] },
    { id: "c", key: "code", input: { source: "return 1" }, next: ["a"] },
    { id: "a", key: "ai", input: { prompt: "Summarise the result" } },
  ] };
  const l = layout(def, {});
  const subs = Object.fromEntries(l.cards.filter((c) => c.node).map((c) => [c.id, c.sub]));
  assert.equal(subs["h"], "GET api.example.com/v1/items");
  assert.equal(subs["c"], "Runs 1 line of code, no network");
  assert.equal(subs["a"], "Summarise the result", "no account words when none was chosen");
});

test("the Data tab of a live step tells where picked data goes, and each shelf row can be picked", () => {
  const node: DefNode = { id: "ask", key: "ai", input: { prompt: "Hi" } };
  const first: DefNode = { id: "lookup", key: "records.find", input: { type: "contact" }, next: ["ask"] };
  const d: Definition = { triggers: [{ key: "manual" }], nodes: [first, node] };
  const out = renderToStaticMarkup(
    <AutomationsDataProvider value={data}>
      <Inspector def={d} node={node} trigger={null} triggerIndex={null} issues={[]} keys={keys} kind="personal" section="data" samples={{ lookup: { rows: [1], count: 1 }, trigger: { email: "a@b.c" } }} onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined} />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
  assert.ok(has(out, 'data-testid="data-shelf-target"'));
  assert.ok(has(out, "Click a field on Configure, then pick data here to put it in."));
  assert.ok(has(out, 'data-testid="mapping-lookup.rows"') && has(out, 'data-testid="mapping-trigger.email"'));
});

test("Advanced shows the same input as JSON beside the form, and what the JSON holds is what the form shows", () => {
  const input = { method: "POST", url: "https://api.example.com/orders", json: { sku: "A-1" }, auth: { kind: "bearer", handle: "#Acme_API" } };
  const node: DefNode = { id: "post", key: "http_request", input };
  const d: Definition = { triggers: [{ key: "manual" }], nodes: [node] };
  const out = renderToStaticMarkup(
    <AutomationsDataProvider value={data}>
      <Inspector def={d} node={node} trigger={null} triggerIndex={null} issues={[]} keys={keys} kind="personal" mode="advanced" onMode={() => undefined} onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined} />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
  assert.ok(has(out, 'data-testid="field-input-json"'));
  assert.ok(has(out, "&quot;url&quot;: &quot;https://api.example.com/orders&quot;"));
  assert.ok(has(out, 'data-testid="field-url"') && has(out, 'data-testid="field-json-body"'), "the form is still there");
});

test("with a run shown, the Test tab carries that run's log for the step, and a missing log says so", () => {
  const node: DefNode = { id: "get", key: "http_request", input: { method: "GET", url: "https://a.example.com" } };
  const d: Definition = { triggers: [{ key: "manual" }], nodes: [node] };
  const out = renderToStaticMarkup(
    <AutomationsDataProvider value={data}>
      <Inspector def={d} node={node} trigger={null} triggerIndex={null} issues={[]} keys={keys} kind="personal" section="test" runId="run_1" onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined} />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
  assert.ok(has(out, 'data-testid="run-step-io"') && has(out, "In the run shown"));
});

test("an HTTP send has Ask before sending, default Off; a read does not, because a read is never held", () => {
  const post = panel({ id: "p", key: "http_request", input: { method: "POST", url: "https://a.example.com", json: {} } });
  assert.ok(has(post, 'data-testid="ask-before-sending"'));
  assert.match(tag(post, "choose-ask-before-sending"), /aria-label="[^"]*Off/);
  assert.ok(has(post, "The send goes out as soon as the step runs."));
  const on = panel({ id: "p", key: "http_request", askBeforeSending: true, input: { method: "DELETE", url: "https://a.example.com" } } as never);
  assert.ok(has(on, "The send waits until someone approves it."));
  assert.equal(has(panel({ id: "g", key: "http_request", input: { method: "GET", url: "https://a.example.com" } }), 'data-testid="ask-before-sending"'), false);
  assert.equal(has(panel({ id: "a", key: "ai", input: { prompt: "p" } }), 'data-testid="ask-before-sending"'), false, "the AI step sends nothing");
});

test("no control is shown for the AI step's nudge or escalation settings, which the engine does not honour", () => {
  const out = panel({ id: "a", key: "ai", input: { prompt: "p" }, ai: { nudgeMinutes: 5, escalateTo: { kind: "person", id: "usr_x" } } });
  assert.equal(/nudge|escalat/i.test(out), false);
});

// ---- the AI step as an agent task (work baton, lane W2)

test("the AI step has an Answer or Task switch, and a step without a mode is an answer", () => {
  const answer = panel({ id: "a", key: "ai", input: { prompt: "p" } });
  assert.ok(has(answer, 'data-testid="ai-mode"'));
  assert.match(tag(answer, "ai-mode-answer"), /aria-checked="true"/);
  assert.match(tag(answer, "ai-mode-task"), /aria-checked="false"/);
  assert.ok(has(answer, 'data-testid="field-prompt"') && !has(answer, 'data-testid="ai-seats"'), "an answer keeps its own form");
  const task = panel({ id: "a", key: "ai", input: { prompt: "p" }, ai: { mode: "task" } });
  assert.match(tag(task, "ai-mode-task"), /aria-checked="true"/);
});

test("a task step shows the goal, the seats with faces, the deliverable as fields, what done means, and keeps the rarely used settings under More", () => {
  const schema = { type: "object", required: ["letter", "pages"], properties: { letter: { type: "string" }, pages: { type: "integer" } } };
  const out = panel({ id: "t", key: "ai", input: { prompt: "Draft the letter for {{ trigger.name }}", outputSchema: schema }, ai: { mode: "task", agentId: "agt_x", reviewer: { kind: "person", id: "usr_maya" }, doneMeans: ["Names the client", "States the fee"], nudgeMinutes: 10 } });
  for (const id of ["field-prompt", "insert-data", "ai-seats", "choose-assigned", "choose-reviewer", "choose-approver", "rows-deliverable", "field-done-means", "ai-more"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.match(tag(out, "field-prompt"), /aria-label="Goal"/);
  assert.equal(value(out, "rows-deliverable-key-0"), "letter");
  assert.match(tag(out, "rows-deliverable-value-1"), /aria-label="Fields type 2: whole number"/, "the type is picked from a menu, not typed");
  assert.ok(has(out, 'data-testid="ai-shape-advanced"'), "the raw shape is behind Advanced");
  assert.ok(has(out, "Names the client") && has(out, "States the fee"));
  assert.match(tag(out, "choose-reviewer"), /aria-label="Reviewer: /);
  assert.equal(has(out, 'data-testid="field-nudge"'), false, "Nudge after is under More, which starts closed");
  assert.equal(has(out, 'data-testid="choose-escalate"'), false);
  assert.equal(has(out, 'data-testid="ai-account"'), false, "the agent works on its own account");
  noDash(out);
});

test("a deliverable that is more than simple fields keeps its raw shape editor", () => {
  const out = panel({ id: "t", key: "ai", input: { prompt: "p", outputSchema: { type: "object", properties: { a: { type: "object", properties: { b: { type: "string" } } } } } }, ai: { mode: "task", agentId: "agt_x" } });
  assert.ok(has(out, 'data-testid="ai-shape-advanced"') && !has(out, 'data-testid="rows-deliverable"'), "no field list for a deeper shape; its editor is under Advanced");
});

test("the card of a task step says it is an agent task in one short line, with no braces and no account", () => {
  const def: Definition = { triggers: [{ key: "manual" }], nodes: [
    { id: "t", key: "ai", input: { prompt: "Draft the letter" }, ai: { mode: "task", agentId: "agt_x" }, next: ["u"] },
    { id: "u", key: "ai", input: { prompt: "Draft the letter" }, ai: { mode: "task", agentId: "agt_x", reviewer: { kind: "person", id: "usr_m" } } },
  ] };
  const subs = Object.fromEntries(layout(def, {}).cards.filter((c) => c.node).map((c) => [c.id, c.sub]));
  assert.equal(subs["t"], "Draft the letter. Agent task");
  assert.equal(subs["u"], "Draft the letter. Agent task");
  assert.equal(layout({ triggers: [{ key: "manual" }], nodes: [{ id: "z", key: "ai", input: { prompt: "Draft for {{ trigger.name }} today." }, ai: { mode: "task", agentId: "a" } }] } as Definition, {}).cards.find((c) => c.id === "z")?.sub, "Draft for \u2026 today. Agent task", "data references are an ellipsis, never braces");
  assert.equal(layout({ triggers: [{ key: "manual" }], nodes: [{ id: "z", key: "ai", input: { prompt: "Draft for {{ trigger.name }}." }, ai: { mode: "task", agentId: "a" } }] } as Definition, {}).cards.find((c) => c.id === "z")?.sub, "Draft for \u2026 \u00b7 Agent task");
});
