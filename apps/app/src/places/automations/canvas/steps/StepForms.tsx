// The forms of the three live steps in the step panel: HTTP request, Run code and the AI step. Every control writes the definition through one function of edits.ts and shows what the server will
// check when the automation is turned on. Nothing here holds a key: an HTTP request names a Vault item by handle, and the lists of items, agents and people come from the signed-in person's own view.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { MenuEntry } from "../../../../../../../ui/src/Menu/index.tsx";
import { Avatar } from "../../../../../../../ui/src/Avatar/index.tsx";
import { ChipText, Choice, Field, Group, Hint, More, Rows, Segmented } from "../fields.tsx";
import { useOpenConnect } from "../../../../shell/connect/context.ts";
import { connectEntries } from "../../../../shell/connect/model.ts";
import { updateStep } from "../model.ts";
import type { DefNode, Definition, KeyChoice } from "../model.ts";
import {
  AUTH_LABEL, CODE_STARTER, HTTP_METHODS, answerKindOf, authOf, bodyKindOf, headerProblem, hostsOf, joinHandle, pairsOf, readsOnly, recordOf, setAnswerKind, setAuth, setBodyKind, setHosts, setJsonBody, setMethod,
  sameKeySteps, setSchemaText, setTimeoutMinutes, splitHandle, withAi, withField,
  addChip, chipLabel, doneMeansText, fieldsOf, FIELD_TYPES, modeOf, schemaFromFields, setDoneMeans, setMode, setNudgeMinutes, setTimeLimit,
} from "./edits.ts";
import type { Assignee, AuthKind, BodyKind, Input } from "./edits.ts";
import type { Load } from "./useLists.ts";
import type { AgentPick, VaultPick, WhoPick } from "./picks.ts";

export type OpenMenu = (entries: MenuEntry[], x: number, y: number, kind: "other") => void;
interface Props { def: Definition; node: DefNode; onChange(next: Definition): void; openMenu: OpenMenu }

const show = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v));
const inputOf = (node: DefNode): Input => (node.input ?? {}) as Input;
const sentence = (load: Load<unknown>, none: string): string | null => (load.state === "loading" ? "Loading..." : load.state === "unavailable" ? none : null);

// ---------------------------------------------------------------- HTTP request

export function HttpForm({ def, node, onChange, openMenu, vault }: Props & { vault: Load<VaultPick> }): ReactElement {
  const input = inputOf(node);
  const write = (next: Input): void => onChange(updateStep(def, node.id, { input: next }));
  const method = typeof input["method"] === "string" ? input["method"] : "GET";
  const reads = readsOnly(method);
  const [jsonProblem, setJsonProblem] = useState<string | null>(null);
  const kind = bodyKindOf(input);
  const auth = authOf(input);
  const items = vault.state === "ready" ? vault.items : [];
  const chosen = splitHandle(auth.handle);
  const item = items.find((i) => i.handle === chosen.item);
  const fieldKeys = item?.fieldKeys ?? [];
  const setAuthPart = (patch: Partial<typeof auth>): void => write(setAuth(input, { ...auth, ...patch }));
  const openConnect = useOpenConnect();
  // a key added in place is taken once the Vault list has loaded again and holds it
  const [wanted, setWanted] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    const found = items.find((i) => i.id === wanted);
    if (!found) return;
    setWanted(null);
    setAuthPart({ handle: joinHandle(found.handle, found.fieldKeys.length === 1 ? found.fieldKeys[0]! : "") });
    // setAuthPart is rebuilt each render and only reads the current form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, items]);
  return (
    <>
      <Choice
        label="Method" value={method} testID="field-method"
        onOpen={(x, y) => openMenu(HTTP_METHODS.map((m) => ({ label: m, checked: m === method, onSelect: () => write(setMethod(input, m)) })), x, y, "other")}
      />
      <Field label="Address" value={show(input["url"])} mono placeholder="https://api.example.com/v1/items" testID="field-url" onCommit={(t) => write(withField(input, "url", t.trim() === "" ? undefined : t.trim()))} />
      <Hint testID="http-address-note">Only https. An address inside a private network, or one that redirects there, is refused every time.</Hint>
      <Rows label="Query" pairs={pairsOf(input["query"])} keyLabel="Name" valueLabel="Value" addLabel="Add a query value" testID="rows-query" onCommit={(rows) => write(withField(input, "query", recordOf(rows, false)))} />
      <Rows
        label="Headers" pairs={pairsOf(input["headers"])} keyLabel="Header" valueLabel="Value" addLabel="Add a header" testID="rows-headers" check={headerProblem}
        onCommit={(rows) => write(withField(input, "headers", recordOf(rows, false)))}
      />
      {reads ? null : (
        <>
          <Choice
            label="Body" value={kind === "json" ? "JSON" : kind === "text" ? "Text" : "No body"} testID="choose-body"
            onOpen={(x, y) => openMenu((["none", "json", "text"] as BodyKind[]).map((k) => ({ label: k === "json" ? "JSON" : k === "text" ? "Text" : "No body", checked: k === kind, onSelect: () => { setJsonProblem(null); write(setBodyKind(input, k)); } })), x, y, "other")}
          />
          {kind === "json" ? (
            <>
              <Field
                label="JSON body" value={JSON.stringify(input["json"], null, 2)} mono rows={6} testID="field-json-body" invalid={jsonProblem !== null}
                onCommit={(t) => { const r = setJsonBody(input, t); if (!r.ok) { setJsonProblem(r.message); return; } setJsonProblem(null); write(r.value); }}
              />
              {jsonProblem ? <Hint danger testID="json-problem">{jsonProblem}</Hint> : <Hint>Use {"{{ steps.name.out.field }}"} to put an earlier step's data in.</Hint>}
            </>
          ) : null}
          {kind === "text" ? <Field label="Text body" value={show(input["text"])} mono rows={5} testID="field-text-body" onCommit={(t) => write(withField(input, "text", t))} /> : null}
        </>
      )}
      <Group head="Authentication" testID="http-auth">
        <Choice
          label="Sign the request with" value={AUTH_LABEL[auth.kind]} testID="choose-auth"
          onOpen={(x, y) => openMenu((["none", "bearer", "basic", "header"] as AuthKind[]).map((k) => ({ label: AUTH_LABEL[k], checked: k === auth.kind, onSelect: () => setAuthPart({ kind: k }) })), x, y, "other")}
        />
        {auth.kind === "none" ? null : (
          <>
            <Choice
              label="Vault key" value={item ? item.name : auth.handle !== "" ? chosen.item : (sentence(vault, "Your Vault could not be read") ?? "Choose a key")} testID="choose-vault-key"
              onOpen={(x, y) => {
                const list: MenuEntry[] = items.map((i) => ({ label: i.name, checked: i.handle === chosen.item, onSelect: () => setAuthPart({ handle: joinHandle(i.handle, i.fieldKeys.length === 1 ? i.fieldKeys[0]! : "") }) }));
                const took = (made: { id: string }): void => setWanted(made.id);
                if (items.length === 0 && vault.state === "loading") { openMenu([{ label: "Loading...", onSelect: () => undefined }], x, y, "other"); return; }
                openMenu(connectEntries(list, { kind: "key" }, openConnect, took, items.length === 0), x, y, "other");
              }}
            />
            {auth.handle !== "" && fieldKeys.length > 1 ? (
              <Choice
                label="Field of that item" value={chosen.field || "Choose a field"} testID="choose-vault-field"
                onOpen={(x, y) => openMenu(fieldKeys.map((k) => ({ label: k, checked: k === chosen.field, onSelect: () => setAuthPart({ handle: joinHandle(chosen.item, k) }) })), x, y, "other")}
              />
            ) : null}
            {auth.kind === "basic" ? <Field label="User name" value={auth.username} testID="field-auth-user" onCommit={(t) => setAuthPart({ username: t.trim() })} /> : null}
            {auth.kind === "header" ? <Field label="Header name" value={auth.header} mono placeholder="x-api-key" testID="field-auth-header" onCommit={(t) => setAuthPart({ header: t.trim() })} /> : null}
            {sameKeySteps(def.nodes, node.id, chosen.item).length > 0 ? <Hint testID="auth-also-used">{`Also used by ${sameKeySteps(def.nodes, node.id, chosen.item).join(", ")} in this Automation.`}</Hint> : null}
            <Hint testID="auth-note">The Vault puts the key in the request when it is sent. It is never saved in this step, shown in a run, or handed to a later step.</Hint>
          </>
        )}
      </Group>
      <Hint testID="http-send-note">{reads ? "A read goes out every time the step runs, including in a test." : "A send is only recorded, not sent, in a test. It carries an Idempotency-Key so a repeat is not a second send."}</Hint>
    </>
  );
}

// ---------------------------------------------------------------- Run code

export function CodeForm({ def, node, onChange }: Omit<Props, "openMenu">): ReactElement {
  const input = inputOf(node);
  const write = (next: Input): void => onChange(updateStep(def, node.id, { input: next }));
  const [hostsText, setHostsText] = useState<string | null>(null);
  const [hostProblem, setHostProblem] = useState<string | null>(null);
  const hosts = hostsOf(input);
  return (
    <>
      <Field label="Code" value={typeof input["source"] === "string" ? input["source"] : CODE_STARTER} mono rows={10} testID="field-source" onCommit={(t) => write(withField(withField(input, "language", "javascript"), "source", t))} />
      <Hint testID="code-contract">JavaScript. The code is a function body: it gets input and log, can await, and returns JSON.</Hint>
      <Rows
        label="Input" pairs={pairsOf(input["input"])} keyLabel="Name" valueLabel="Value" addLabel="Add an input" testID="rows-input"
        onCommit={(rows) => write(withField(input, "input", recordOf(rows, true)))}
      />
      <Field
        label="Hosts it may reach" value={hostsText ?? hosts.join("\n")} mono rows={3} placeholder="One host per line, such as api.example.com" testID="field-hosts" invalid={hostProblem !== null}
        onCommit={(t) => { const r = setHosts(input, t); if (!r.ok) { setHostsText(t); setHostProblem(r.message); return; } setHostsText(null); setHostProblem(null); write(r.value); }}
      />
      {hostProblem ? <Hint danger testID="hosts-problem">{hostProblem}</Hint> : <Hint testID="code-network">{hosts.length === 0 ? "No network. Name a host to let fetch reach it; every other address stays closed." : `fetch reaches ${hosts.join(", ")} and nothing else.`}</Hint>}
      <Hint testID="code-limits">Runs in a sandbox with 10 seconds of processor time, 128 MB of memory and 1 MB of output. No files, no Vault and no other program.</Hint>
    </>
  );
}

// ---------------------------------------------------------------- AI step

const nameOf = (id: string, picks: readonly { assignee: Assignee; name: string }[], me: { id: string; name: string }): string => (id === me.id ? `${me.name} (you)` : (picks.find((p) => p.assignee.id === id)?.name ?? id));

export function AiForm({ def, node, onChange, openMenu, kind, keys, agents, who, me, lookup }: Props & {
  kind: "personal" | "space"; keys: readonly KeyChoice[]; agents: Load<AgentPick>; who: Load<WhoPick>; me: { id: string; name: string };
  /** The place's own name for a person, agent, group or role by id (the id comes back when it does not know). */
  lookup?: (id: string) => string;
}): ReactElement {
  const input = inputOf(node);
  const writeInput = (next: Input): void => onChange(updateStep(def, node.id, { input: next }));
  const writeAi = (ai: NonNullable<DefNode["ai"]>): void => onChange(updateStep(def, node.id, { ai }));
  const openConnect = useOpenConnect();
  const [schemaProblem, setSchemaProblem] = useState<string | null>(null);
  const [minutesProblem, setMinutesProblem] = useState<string | null>(null);
  const ai = node.ai ?? {};
  const answer = answerKindOf(input);
  const keyName = (id: string | undefined, none: string): string => (id ? (keys.find((k) => k.id === id)?.name ?? id) : none);
  const pickable = kind === "space" ? keys.filter((k) => k.shared !== false) : keys;
  const pickKey = (field: "keyId" | "backupKeyId", none: string) => (x: number, y: number): void => {
    const entries: MenuEntry[] = [{ label: none, checked: !ai[field], onSelect: () => writeAi(withAi(ai, field, undefined)) }];
    if (pickable.length > 0) entries.push({ separator: true });
    for (const k of pickable) entries.push({ label: `${k.name}${k.kind === "subscription" ? " (sign-in)" : " (API key)"}`, checked: ai[field] === k.id, onSelect: () => writeAi(withAi(ai, field, k.id)) });
    // the connect item ends the menu; when the flow finishes the new account is the one this field takes
    openMenu(connectEntries(entries, { kind: "ai" }, openConnect, (made) => writeAi(withAi(ai, field, made.id)), pickable.length === 0), x, y, "other");
  };
  const pickWho = (field: "reviewer" | "approver") => (x: number, y: number): void => {
    const people = who.state === "ready" ? who.items : [];
    const entries: MenuEntry[] = [
      { label: "Nobody", checked: !ai[field], onSelect: () => writeAi(withAi(ai, field, undefined)) },
      { separator: true },
      { label: `${me.name} (you)`, checked: ai[field]?.id === me.id, onSelect: () => writeAi(withAi(ai, field, { kind: "person", id: me.id })) },
    ];
    for (const p of people) if (p.assignee.id !== me.id) entries.push({ label: p.name, checked: ai[field]?.id === p.assignee.id, onSelect: () => writeAi(withAi(ai, field, p.assignee)) });
    openMenu(entries, x, y, "other");
  };
  const whoLine = (a: Assignee | undefined): string => (!a ? "Nobody" : a.id === me.id ? `${me.name} (you)` : who.state === "ready" ? nameOf(a.id, who.items, me) : who.state === "loading" ? "Loading..." : a.id);
  const agentList = agents.state === "ready" ? agents.items : [];
  const taskMode = modeOf(ai) === "task";
  const [nudgeProblem, setNudgeProblem] = useState<string | null>(null);
  /** A seat's name: the loaded lists first, then the place's own lookup; never a raw id (a word for the kind when nobody knows it). */
  const seatName = (a: Assignee): string => {
    if (a.id === me.id) return `${me.name} (you)`;
    const listed = a.kind === "agent" ? agentList.find((x) => x.id === a.id)?.name : who.state === "ready" ? who.items.find((p) => p.assignee.id === a.id)?.name : undefined;
    const known = listed ?? lookup?.(a.id);
    return known && known !== a.id ? known : a.kind === "agent" ? "An agent" : a.kind === "person" ? "A teammate" : a.kind === "group" ? "A group" : "A role";
  };
  const face = (a: Assignee | undefined): ReactElement | undefined => (a ? <Avatar name={seatName(a)} seedId={a.id} kind={a.kind === "role" ? "group" : a.kind} size={16} /> : undefined);
  // in a task any seat may be an agent, a person or a group
  const pickSeat = (field: "assigned" | "reviewer" | "approver", none: string) => (x: number, y: number): void => {
    const people = who.state === "ready" ? who.items : [];
    const put = (a: Assignee | undefined): void => {
      const next = withAi(ai, field, a);
      writeAi(field === "assigned" ? withAi(next, "agentId", a?.kind === "agent" ? a.id : undefined) : next);
    };
    const entries: MenuEntry[] = [{ label: none, checked: !ai[field] && !(field === "assigned" && ai.agentId), onSelect: () => put(undefined) }];
    if (agentList.length > 0) { entries.push({ separator: true }); for (const a of agentList) entries.push({ label: `${a.name} (agent)`, checked: ai[field]?.id === a.id || (field === "assigned" && !ai.assigned && ai.agentId === a.id), onSelect: () => put({ kind: "agent", id: a.id }) }); }
    entries.push({ separator: true }, { label: `${me.name} (you)`, checked: ai[field]?.id === me.id, onSelect: () => put({ kind: "person", id: me.id }) });
    for (const p of people) if (p.assignee.id !== me.id) entries.push({ label: p.name, checked: ai[field]?.id === p.assignee.id, onSelect: () => put(p.assignee) });
    openMenu(entries, x, y, "other");
  };
  const seatLine = (a: Assignee | undefined, fallback: string): string => (a ? seatName(a) : fallback);
  const assigned: Assignee | undefined = ai.assigned ?? (ai.agentId ? { kind: "agent", id: ai.agentId } : undefined);
  // data the goal can bring in: what started the run, and each other step's output
  const stepTitle = (id: string): string => { const n = def.nodes.find((x) => x.id === id); return (n as { title?: string } | undefined)?.title ?? id; };
  const insertData = (x: number, y: number): void => {
    const add = (ref: string): void => writeInput(withField(input, "prompt", addChip(String(input["prompt"] ?? ""), ref)));
    openMenu([
      { label: "What started the run", onSelect: () => add("trigger") },
      ...def.nodes.filter((n) => n.id !== node.id).map((n): MenuEntry => ({ label: `Output of ${(n as { title?: string }).title ?? n.id}`, onSelect: () => add(`steps.${n.id}.out`) })),
    ], x, y, "other");
  };
  const flat = fieldsOf(input["outputSchema"]);
  if (taskMode) {
    return (
      <>
        <Segmented testID="ai-mode" value="task" onPick={(k) => onChange(updateStep(def, node.id, { ai: setMode(ai, k === "task" ? "task" : "answer") }))} options={[{ key: "answer", label: "Answer", hint: "One quick answer, no tools" }, { key: "task", label: "Task", hint: "Real work: an agent with its tools, in its own thread" }]} />
        <ChipText label="Goal" value={show(input["prompt"])} placeholder="What should be done? Bring in data with Insert data." testID="field-prompt" hint="What the agent is asked to do. Written like a note to a colleague." chipLabel={(ref) => chipLabel(ref, stepTitle)} onCommit={(t) => writeInput(withField(input, "prompt", t))} />
        <Choice label="Insert data" value="Pick something to bring in" testID="insert-data" hint="Adds a {{ }} reference to the goal" onOpen={insertData} />
        <Rows label="Input data" pairs={pairsOf(input["inputs"])} keyLabel="Name" valueLabel="Value" addLabel="Add input data" testID="rows-inputs" onCommit={(rows) => writeInput(withField(input, "inputs", recordOf(rows, true)))} />
        <Group head="Who" testID="ai-seats">
          <Choice label="Assigned" value={seatLine(assigned, "Pick who does it")} face={face(assigned)} testID="choose-assigned" hint="Does the work, in the task's thread" onOpen={pickSeat("assigned", "Nobody yet")} />
          <Choice label="Reviewer" value={seatLine(ai.reviewer, "Nobody")} face={face(ai.reviewer)} testID="choose-reviewer" hint="Checks the work against Done means and sends it back with fixes" onOpen={pickSeat("reviewer", "Nobody")} />
          <Choice label="Approver" value={seatLine(ai.approver, "Nobody")} face={face(ai.approver)} testID="choose-approver" hint="Decides it may go ahead; held actions go out on a yes" onOpen={pickSeat("approver", "Nobody")} />
        </Group>
        <Group head="Deliverable" testID="ai-deliverable">
          {flat ? (
            <Rows
              label="Fields" pairs={flat} keyLabel="Name" valueLabel="Type" addLabel="Add a field" testID="rows-deliverable" newValue="text"
              onPickValue={(current, x, y, set) => openMenu(FIELD_TYPES.map((t) => ({ label: t.word, checked: t.word === current, onSelect: () => set(t.word) })), x, y, "other")}
              onCommit={(rows) => writeInput(withField(input, "outputSchema", schemaFromFields(rows)))}
            />
          ) : null}
          <More head="Advanced" testID="ai-shape-advanced">
            <Field label="Shape (JSON Schema)" value={JSON.stringify(input["outputSchema"] ?? {}, null, 2)} mono rows={8} testID="field-schema" invalid={schemaProblem !== null} onCommit={(t) => { const r = setSchemaText(input, t); if (!r.ok) { setSchemaProblem(r.message); return; } setSchemaProblem(null); writeInput(r.value); }} />
            {schemaProblem ? <Hint danger testID="schema-problem">{schemaProblem}</Hint> : null}
          </More>
          <Hint testID="deliverable-note">{flat ? "The agent hands these in; a wrong one is sent back to it." : "A shape with more than simple fields: edit it under Advanced."}</Hint>
        </Group>
        <Field label="Done means" value={doneMeansText(ai)} rows={4} placeholder="One check per line" testID="field-done-means" hint="The reviewer checks the work against these" onCommit={(t) => writeAi(setDoneMeans(ai, t))} />
        <More head="More" testID="ai-more">
          <Field
            label="Time limit (minutes)" value={ai.timeoutMinutes === undefined ? "" : String(ai.timeoutMinutes)} placeholder="None" testID="field-timeout" invalid={minutesProblem !== null} hint="The agent is told to take at most this long"
            onCommit={(t) => { const r = setTimeLimit(ai, t, 1440); if (!r.ok) { setMinutesProblem(r.message); return; } setMinutesProblem(null); writeAi(r.value); }}
          />
          {minutesProblem ? <Hint danger testID="timeout-problem">{minutesProblem}</Hint> : null}
          <Field
            label="Nudge after (minutes)" value={ai.nudgeMinutes === undefined ? "" : String(ai.nudgeMinutes)} placeholder="30" testID="field-nudge" invalid={nudgeProblem !== null} hint="If the agent stops without handing over, it goes to a person after this long"
            onCommit={(t) => { const r = setNudgeMinutes(ai, t); if (!r.ok) { setNudgeProblem(r.message); return; } setNudgeProblem(null); writeAi(r.value); }}
          />
          {nudgeProblem ? <Hint danger testID="nudge-problem">{nudgeProblem}</Hint> : null}
          <Choice label="Escalate to" value={seatLine(ai.escalateTo, "The person who owns this")} face={face(ai.escalateTo)} testID="choose-escalate" hint="Who gets it when the agent stalls" onOpen={pickSeat("escalateTo" as never, "The person who owns this")} />
        </More>
        <Hint testID="ai-tools-note">The agent works in the task's thread with its tools, on its own account. Anything that leaves Vyre waits for a yes.</Hint>
      </>
    );
  }
  return (
    <>
      <Segmented testID="ai-mode" value="answer" onPick={(k) => onChange(updateStep(def, node.id, { ai: setMode(ai, k === "task" ? "task" : "answer") }))} options={[{ key: "answer", label: "Answer", hint: "One quick answer, no tools" }, { key: "task", label: "Task", hint: "Real work: an agent with its tools, in its own thread" }]} />
      <Field label="Prompt" value={show(input["prompt"])} rows={6} placeholder="What should the AI do? Use {{ steps.name.out.field }} to bring an earlier step's data in." testID="field-prompt" onCommit={(t) => writeInput(withField(input, "prompt", t))} />
      <Rows label="Input data" pairs={pairsOf(input["inputs"])} keyLabel="Name" valueLabel="Value" addLabel="Add input data" testID="rows-inputs" onCommit={(rows) => writeInput(withField(input, "inputs", recordOf(rows, true)))} />
      <Choice
        label="Run as" value={ai.agentId ? (agentList.find((a) => a.id === ai.agentId)?.name ?? ai.agentId) : (sentence(agents, "Your agents could not be loaded") ?? "No agent")} testID="choose-agent"
        onOpen={(x, y) => openMenu([
          { label: "No agent", checked: !ai.agentId, onSelect: () => writeAi(withAi(ai, "agentId", undefined)) },
          ...(agentList.length > 0 ? [{ separator: true } as MenuEntry] : []),
          ...agentList.map((a): MenuEntry => ({ label: a.name, checked: ai.agentId === a.id, onSelect: () => writeAi(withAi(ai, "agentId", a.id)) })),
        ], x, y, "other")}
      />
      <Hint testID="agent-note">{ai.agentId ? "The turn takes the agent's name, role, model and the memory you may read. It does not get the agent's tools." : "With no agent the turn is a plain question and answer."}</Hint>
      <Group head="Account" testID="ai-account">
        <Choice label="Runs on" value={keyName(ai.keyId, kind === "space" ? "Choose a shared key" : "Your own AI account")} testID="choose-key" onOpen={pickKey("keyId", kind === "space" ? "No key" : "Your own AI account")} />
        <Choice label="Backup" value={keyName(ai.backupKeyId, "No backup")} testID="choose-backup" onOpen={pickKey("backupKeyId", "No backup")} />
        <Hint testID="account-note">{kind === "space" ? "A Space automation runs as itself and can use only a key shared with the Space." : "A Personal automation runs on your own AI account unless you pick another."}</Hint>
      </Group>
      <Group head="Answer" testID="ai-answer">
        <Choice
          label="Answer as" value={answer === "json" ? "JSON in a shape I set" : "Free text"} testID="choose-answer"
          onOpen={(x, y) => openMenu([
            { label: "Free text", checked: answer === "text", onSelect: () => { setSchemaProblem(null); writeInput(setAnswerKind(input, "text")); } },
            { label: "JSON in a shape I set", checked: answer === "json", onSelect: () => writeInput(setAnswerKind(input, "json")) },
          ], x, y, "other")}
        />
        {answer === "json" ? (
          <>
            <Field
              label="Shape (JSON Schema)" value={JSON.stringify(input["outputSchema"], null, 2)} mono rows={8} testID="field-schema" invalid={schemaProblem !== null}
              onCommit={(t) => { const r = setSchemaText(input, t); if (!r.ok) { setSchemaProblem(r.message); return; } setSchemaProblem(null); writeInput(r.value); }}
            />
            {schemaProblem ? <Hint danger testID="schema-problem">{schemaProblem}</Hint> : <Hint testID="schema-note">The step fails by name if the answer does not match, and later steps read it as data.</Hint>}
          </>
        ) : null}
      </Group>
      <Group head="Before it goes on" testID="ai-review">
        <Choice label="Reviewer" value={whoLine(ai.reviewer)} testID="choose-reviewer" onOpen={pickWho("reviewer")} />
        <Choice label="Approver" value={whoLine(ai.approver)} testID="choose-approver" onOpen={pickWho("approver")} />
        <Hint testID="review-note">{ai.reviewer || ai.approver ? "The answer waits as a task. The run goes on when it is accepted and stops if it is not." : "With nobody named the answer goes straight on."}</Hint>
      </Group>
      <Field
        label="Give up after (minutes)" value={ai.timeoutMinutes === undefined ? "" : String(ai.timeoutMinutes)} placeholder="5" testID="field-timeout" invalid={minutesProblem !== null}
        onCommit={(t) => { const r = setTimeoutMinutes(ai, t); if (!r.ok) { setMinutesProblem(r.message); return; } setMinutesProblem(null); writeAi(r.value); }}
      />
      {minutesProblem ? <Hint danger testID="timeout-problem">{minutesProblem}</Hint> : null}
      <Hint testID="ai-tools-note">The turn has no tools. It answers in words and cannot send or change anything itself.</Hint>
    </>
  );
}
