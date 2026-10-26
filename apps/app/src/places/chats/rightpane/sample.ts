// The sample Spaces behind the Chats right pane tests and screenshots: Northwind (Intake is working on its computer), Northwind with Intake asleep, and a Personal Space (the
// assistant, no computer). Filled from the prototype's agent pane so a side by side reads the same. A fake replica holds the rows; each capability the pane reads is registered
// with a resolver over those rows, and the writes it makes change the rows, so every control in a mount really works. The real replica is SQLite behind the same surface.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { ChatRightPaneData, Connection, RightPaneNav } from "./data.tsx";
import type { AgentRow, Computer, FileRow, FolderRow, Helper, Routine, Session, Step, Thread } from "./model.ts";
import type { Fact } from "./model.ts";

/** Friday 24 October 2025, 10:00 (UTC, so every machine prints the same times). */
export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const at = (m: number, d: number, h: number, min = 0): number => Date.UTC(2025, m - 1, d, h, min, 0);
const MIN = 60_000;

export type Variant = "northwind" | "asleep" | "personal";

export interface Sample {
  data: ChatRightPaneData;
  replica: FakeReplica;
  /** every capability the pane called, in order */
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open, as "kind:id" */
  opened: string[];
  /** the last text put in the composer */
  composer: { text: string };
  setOnline(online: boolean): void;
  /** make the next call to `cap` fail */
  failNext(cap: string): void;
}

const INTAKE = "agt_intake";
const COMPUTER = "cmp_intake";
const FOLDER = "fld_agt_intake";

const agent = (id: string, name: string, role: string, o: Partial<AgentRow> = {}): AgentRow => ({
  agentId: id, name, face: name[0]!, role, status: "awake", ownerId: "usr_omar", folderId: `fld_${id}`, accountPolicy: "asker", toolsAllowed: [], toolsDenied: [], vaultKeys: [], limits: {},
  captureMode: "propose", hasComputer: false, templateVersion: 7, createdAt: at(10, 1, 9), ...o,
});

const thread = (threadId: string, kind: Thread["kind"], title: string, createdAt: number, o: Partial<Thread> = {}): Thread => ({
  threadId, kind, title, listed: true, planMode: false, members: [{ kind: "person", id: "usr_irfad" }], agents: [{ agentId: INTAKE, mode: "lead" }], createdAt, ...o,
});

const fact = (factId: string, text: string, o: Partial<Fact> & { fromMe?: boolean }): Fact & { fromMe?: boolean } => ({
  factId, layer: "agent", ownerRef: INTAKE, agentId: INTAKE, text, validFrom: at(10, 23, 9), learnedAt: at(10, 24, 9, 25), sourceKind: "chat", sourceRef: "c1", status: "current", ...o,
});

const routine = (routineId: string, title: string, cron: string | undefined, prompt: string, o: Partial<Routine> = {}): Routine => ({
  routineId, agentId: INTAKE, title, ...(cron !== undefined ? { cron } : {}), prompt, enabled: true, ownerId: "usr_omar", ...o,
});

const folder = (folderId: string, parentId: string, name: string, fileCount: number, folderCount: number): FolderRow => ({
  folderId, parentId, name, path: `Agents/Intake/${name}`, fileCount, folderCount, scope: "space", label: 0, git: false, reviewChanges: false,
});

const file = (fileId: string, folderId: string, name: string, size: number, updatedAt: number, kind: FileRow["kind"] = "markdown"): FileRow => ({
  fileId, folderId, name, kind, mime: kind === "markdown" ? "text/markdown" : "text/plain", size, version: 1, label: 0, ownerId: "usr_omar", createdAt: at(10, 2, 9), updatedAt, updatedBy: "usr_omar", thumb: false, holds: 0,
});

export function createSample(variant: Variant = "northwind", o: { online?: boolean } = {}): Sample {
  const personal = variant === "personal";
  const replica = createFakeReplica(personal ? "personal" : "northwind");
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const composer = { text: "" };
  const failing = new Set<string>();
  const listeners = new Set<() => void>();
  let online = o.online ?? true;
  const agentId = personal ? "agt_assistant" : INTAKE;
  const agentName = personal ? "Assistant" : "Intake";

  // ----- the rows
  const agents: AgentRow[] = personal
    ? [agent("agt_assistant", "Assistant", "Your assistant for anything in this Space")]
    : [agent(INTAKE, "Intake", "Books first calls and follows up on cold inquiries", { status: variant === "asleep" ? "asleep" : "working", hasComputer: true, folderId: FOLDER })];
  replica.put("agents", agents.map((a) => ({ id: a.agentId, ...a })));

  const computer: Computer = {
    computerId: COMPUTER, agentId: INTAKE, state: variant === "asleep" ? "asleep" : "working", tabs: 3, tabLimit: 8, host: "server", recording: false,
    ...(variant === "asleep" ? { lastActiveAt: at(10, 24, 9, 31) } : { caption: "Filling the supplier records form", lastFrameAt: SAMPLE_NOW - 2000 }),
  };
  if (!personal) replica.put("computers", [{ id: COMPUTER, ...computer }]);
  const steps: Step[] = [
    { stepId: "stp1", idx: 0, at: SAMPLE_NOW - 9 * MIN, caption: "Opened the supplier records site", tool: "Chrome", by: "agent" },
    { stepId: "stp2", idx: 1, at: SAMPLE_NOW - 8 * MIN, caption: "Searched for Acme, Elena", tool: "Chrome", by: "agent" },
    { stepId: "stp3", idx: 2, at: SAMPLE_NOW - 7 * MIN, caption: "Saved the 2019 deed to Files", tool: "Files", by: "agent" },
    { stepId: "stp4", idx: 3, at: SAMPLE_NOW - 5 * MIN, caption: "Checked the filing date", tool: "Terminal", by: "agent" },
    { stepId: "stp5", idx: 4, at: SAMPLE_NOW - 1 * MIN, caption: "Filling the supplier records form", tool: "Chrome", by: "agent" },
  ];
  if (!personal) replica.put("steps", steps.map((x) => ({ id: x.stepId, ...x })));
  const sessions: Session[] = [
    { site: "Google Workspace", signedInAs: "intake@northwind.example", since: at(10, 2, 9), lastSeen: SAMPLE_NOW - 3 * MIN },
    { site: "Web form inbox", signedInAs: "forms.northwind.example", since: at(10, 2, 9), lastSeen: SAMPLE_NOW - 40 * MIN },
    { site: "Calendar", signedInAs: "Maya Chen's calendar, can book", since: at(10, 9, 14), lastSeen: SAMPLE_NOW - 3 * 60 * MIN },
  ];
  if (!personal) replica.put("sessions", sessions.map((x) => ({ id: x.site, ...x })));

  const threads: Thread[] = personal
    ? [thread("m1", "chat", "Plan the week", at(10, 24, 8, 5), { agents: [{ agentId: "agt_assistant", mode: "lead" }] }), thread("m2", "chat", "Flights to Kuala Lumpur", at(10, 23, 18, 40), { agents: [{ agentId: "agt_assistant", mode: "lead" }] })]
    : [
      thread("c1", "chat", "Acme intake", at(10, 24, 9, 31)),
      thread("c5", "chat", "Weekly lead report", at(10, 20, 9, 0)),
      thread("th_a", "thread", "#intake · Omar Haddad", at(10, 24, 9, 28), { parentThreadId: "c1", replyCount: 5, lastMessageAt: at(10, 24, 9, 34) }),
    ];
  replica.put("threads", threads.map((x) => ({ id: x.threadId, ...x })));
  const helpers: Helper[] = personal ? [] : [
    { threadId: "h4", title: "Supplier mirrors", status: "running", agentId: INTAKE, model: "haiku", startedAt: SAMPLE_NOW - 4 * MIN },
    { threadId: "h1", title: "Firms 1–3", status: "done", agentId: INTAKE, model: "haiku", startedAt: at(10, 24, 8, 40) },
  ];
  replica.put("helpers", helpers.map((x) => ({ id: x.threadId, ...x })));

  const facts: (Fact & { fromMe?: boolean })[] = personal ? [] : [
    fact("f1", "Elena Acme was referred by Maya Chen.", { validFrom: at(10, 23, 9), learnedAt: at(10, 24, 9, 25), sourceRef: "c1" }),
    fact("f2", "Consults are 1 hour, booked on Maya's calendar.", { validFrom: at(10, 2, 9), learnedAt: at(10, 2, 9), sourceKind: "manual", sourceRef: "c8", fromMe: true }),
    fact("f3", "The consult fee is $250; Maya waives it for her referrals.", { validFrom: at(10, 10, 9), learnedAt: at(10, 10, 9), sourceKind: "channel", sourceRef: "intake" }),
    fact("f4", "Consults are 30 minutes.", { validFrom: at(9, 1, 9), learnedAt: at(9, 1, 9), validTo: at(10, 2, 9), closedAt: at(10, 2, 9), sourceKind: "channel", sourceRef: "intake", status: "closed" }),
    fact("p1", "Consult invoices go out the same day as the call.", { status: "proposed", learnedAt: at(10, 24, 9, 31) }),
    fact("p2", "Elena's business partner, Dev Rao, may call about the launch.", { status: "proposed", learnedAt: at(10, 24, 9, 28) }),
    fact("p3", "Thursday mornings are never offered for consults.", { status: "proposed", learnedAt: at(10, 24, 9, 29), sourceKind: "channel", sourceRef: "intake" }),
  ];
  replica.put("facts", facts.map((x) => ({ id: x.factId, ...x })));

  const routines: Routine[] = personal ? [] : [
    routine("r3", "Morning lead sweep", "0 8 * * 1-5", "Every weekday at 8, check the web form inbox and the shared intake email for new leads since yesterday. Add each to Records as a Lead with source and first message, skip duplicates, and post a short summary in #intake.", { channelId: "intake", lastRunAt: at(10, 24, 8), nextRunAt: at(10, 27, 8) }),
    // a watcher: it fires on a new message in #intake, so it has no cron
    routine("r4", "Watch #intake for new clients", undefined, "Whenever a message lands in #intake from someone new, open a Lead in Records, post the first reply and tag Omar.", { kind: "watch", watch: { on: "message", channelId: "intake" }, lastRunAt: at(10, 24, 9, 34) }),
    routine("r5", "Chase missing intake forms", "0 17 * * *", "Every day at 5pm, find Leads whose intake form isn't back after 2 days and send one friendly reminder from the shared inbox. Stop after two reminders.", { enabled: false, lastRunAt: at(10, 21, 17) }),
  ];
  replica.put("routines", routines.map((x) => ({ id: x.routineId, ...x })));

  const folders: FolderRow[] = personal ? [] : [
    folder("fld_memory", FOLDER, "memory", 1, 4), folder("fld_skills", FOLDER, "skills", 0, 2), folder("fld_routines", FOLDER, "routines", 3, 0), folder("fld_knowledge", FOLDER, "knowledge", 2, 0),
    folder("fld_inbox", FOLDER, "inbox", 0, 0), folder("fld_work", FOLDER, "work", 0, 3), folder("fld_downloads", FOLDER, "downloads", 1, 0), folder("fld_logs", FOLDER, "logs", 1, 0),
    folder("fld_chats", FOLDER, "chats", 1, 0),
    folder("fld_notes", "fld_memory", "notes", 5, 0), folder("fld_proposed", "fld_memory", "proposed", 3, 0), folder("fld_recipes", "fld_memory", "recipes", 1, 0), folder("fld_journal", "fld_memory", "journal", 1, 0),
  ];
  replica.put("folders", folders.map((x) => ({ id: x.folderId, ...x })));
  const files: FileRow[] = personal ? [] : [
    file("fl_agent", FOLDER, "AGENT.md", 2150, at(10, 22, 11)), file("fl_toml", FOLDER, "agent.toml", 940, at(10, 15, 9), "text"),
    file("fl_map", "fld_memory", "MAP.md", 612, at(10, 24, 9, 31)),
    file("fl_r1", "fld_routines", "morning_lead_sweep.md", 410, at(10, 9, 9)), file("fl_r2", "fld_routines", "watch_intake_for_new_clients.md", 380, at(10, 9, 9)),
    file("fl_r3", "fld_routines", "chase_missing_intake_forms.md", 360, at(10, 9, 9)),
  ];
  replica.put("files", files.map((x) => ({ id: x.fileId, ...x })));

  // ----- reads
  const rowsOf = <T,>(table: string): T[] => replica.rows(table) as unknown as T[];
  const strip = <T extends object>(x: T, extra: string[]): T => { const c = { ...x } as Record<string, unknown>; delete c.id; for (const k of extra) delete c[k]; return c as T; };
  replica.resolve("agents.get", (_t, input) => {
    const a = rowsOf<AgentRow & Row>("agents").find((x) => x.agentId === input.agentId);
    if (!a) throw new Error("no such agent");
    return { agent: strip(a, []) };
  });
  replica.resolve("computers.get", (_t, input) => {
    const c = rowsOf<Computer & Row>("computers").find((x) => x.computerId === input.computerId);
    if (!c) throw new Error("no such computer");
    return { computer: strip(c, []) };
  });
  replica.resolve("computers.sessions.list", () => ({ sessions: rowsOf<Session & Row>("sessions").map((x) => strip(x, [])) }));
  replica.resolve("computers.timeline", () => ({ steps: rowsOf<Step & Row>("steps").map((x) => strip(x, [])), total: rowsOf("steps").length }));
  replica.resolve("threads.list", (_t, input) => {
    let list = rowsOf<Thread & Row>("threads").map((x) => strip(x, []));
    if (input.parentThreadId) list = list.filter((x) => x.parentThreadId === input.parentThreadId);
    const kinds = input.kind;
    if (kinds) list = list.filter((x) => kinds.includes(x.kind));
    return { threads: list, total: list.length };
  });
  replica.resolve("chat.helpers.list", () => ({ helpers: rowsOf<Helper & Row>("helpers").map((x) => strip(x, [])) }));
  replica.resolve("memory.facts.list", (_t, input) => {
    const status = input.status ?? ["current"];
    const list = rowsOf<Fact & { fromMe?: boolean } & Row>("facts")
      .filter((x) => (input.agentId ? x.agentId === input.agentId : true) && status.includes(x.status) && (input.fromMe ? x.fromMe === true : true))
      .map((x) => strip(x, ["fromMe"]));
    return { facts: list, total: list.length };
  });
  const countsOut = () => {
    const all = rowsOf<Fact & { fromMe?: boolean }>("facts");
    return { current: all.filter((x) => x.status === "current").length, proposed: all.filter((x) => x.status === "proposed").length, fromMe: all.filter((x) => x.status === "current" && x.fromMe === true).length, autoMerged: 2 };
  };
  replica.resolve("memory.counts", countsOut);
  replica.resolve("agents.routines.list", () => ({ routines: rowsOf<Routine & Row>("routines").map((x) => strip(x, [])) }));
  replica.resolve("files.list", (_t, input) => {
    const folder = input.folder ?? FOLDER;
    return {
      files: rowsOf<FileRow & Row>("files").filter((x) => x.folderId === folder).map((x) => strip(x, [])),
      folders: rowsOf<FolderRow & Row>("folders").filter((x) => x.parentId === folder).map((x) => strip(x, [])),
    };
  });

  // ----- writes
  const patchComputer = (p: Partial<Computer>): Computer => {
    const cur = rowsOf<Computer & Row>("computers")[0]!;
    const next = { ...cur, ...p } as Computer & Row;
    replica.put("computers", [next]);
    return strip(next, []);
  };
  const setFact = (factId: string, p: Partial<Fact>): Fact => {
    const cur = rowsOf<Fact & Row>("facts").find((x) => x.factId === factId);
    if (!cur) throw new Error("no such fact");
    const next = { ...cur, ...p } as Fact & Row;
    replica.put("facts", [next]);
    return strip(next, ["fromMe"]);
  };
  let seq = 0;
  const delegatedFrom = new Map<string, string>();
  const MAP_MD = ["# Intake memory map", "", "- `elena-acme` client referred by Maya, call Thursday", "- `consult-rules` length, host and fee", "- `maya-calendar` when Maya is free and what she blocks",
    "- `intake-form-site` how the web intake form reaches us", "- `weekly-lead-report` what the Friday report holds"].join("\n");
  const mapOut = () => ({ map: { body: MAP_MD, lines: MAP_MD.split("\n").filter((l) => l.startsWith("- `")).length, updatedAt: at(10, 24, 9, 31) } });
  replica.resolve("memory.map.get", mapOut);
  const writes: Record<string, (input: any) => unknown> = {
    // reads the pane makes with a plain call (not a live query)
    "memory.map.get": () => mapOut(),
    "memory.counts": () => countsOut(),
    "computers.wake": () => ({ computer: patchComputer({ state: "working", caption: "Waking up" }) }),
    "computers.sleep": () => ({ computer: patchComputer({ state: "asleep" }) }),
    "computers.take_over": () => ({ computer: patchComputer({ state: "takeover", takeoverBy: "usr_irfad" }) }),
    "computers.give_back": () => ({ computer: patchComputer({ state: "working" }) }),
    "computers.provision": () => ({ computer }),
    "computers.session.sign_out": (i: { site: string }) => { replica.remove("sessions", [i.site]); return { signedOut: true }; },
    "memory.fact.accept": (i: { factId: string }) => ({ fact: setFact(i.factId, { status: "current" }) }),
    "memory.fact.reject": (i: { factId: string }) => ({ fact: setFact(i.factId, { status: "removed" }) }),
    "memory.fact.correct": (i: { factId: string; text: string }) => {
      const closed = setFact(i.factId, { status: "closed", closedAt: SAMPLE_NOW, validTo: SAMPLE_NOW });
      const id = `f_new${++seq}`;
      const next = fact(id, i.text, { validFrom: SAMPLE_NOW, learnedAt: SAMPLE_NOW, sourceKind: "manual", sourceRef: "usr_irfad", fromMe: true });
      replica.put("facts", [{ id, ...next }]);
      return { fact: strip(next, ["fromMe"]), closed };
    },
    "memory.facts.remove": (i: { factIds?: string[] }) => { for (const id of i.factIds ?? []) setFact(id, { status: "removed" }); return { removed: (i.factIds ?? []).length }; },
    "agents.routine.save": (i: { routineId?: string; agentId: string; title: string; cron?: string; kind?: "schedule" | "watch"; watch?: { on: "message"; channelId: string }; prompt: string; channelId?: string; enabled?: boolean }) => {
      const id = i.routineId ?? `r_new${++seq}`;
      const cur = rowsOf<Routine & Row>("routines").find((x) => x.routineId === id);
      const next: Routine = { ...(cur ? strip(cur, []) : { ownerId: "usr_irfad" }), routineId: id, agentId: i.agentId, title: i.title, ...(i.cron !== undefined ? { cron: i.cron } : {}), ...(i.kind !== undefined ? { kind: i.kind } : {}), ...(i.watch !== undefined ? { watch: i.watch } : {}), prompt: i.prompt, enabled: i.enabled ?? true, ...(i.channelId ? { channelId: i.channelId } : {}) };
      replica.put("routines", [{ id, ...next }]);
      return { routine: next };
    },
    "agents.routine.run_now": (i: { routineId: string }) => {
      const cur = rowsOf<Routine & Row>("routines").find((x) => x.routineId === i.routineId);
      if (!cur) throw new Error("no such routine");
      const next = { ...cur, lastRunAt: SAMPLE_NOW } as Routine & Row;
      replica.put("routines", [next]);
      return { routine: strip(next, []) };
    },
    "agents.routine.delegate": (i: { routineId: string; to?: { kind: string; id: string }; undo?: boolean }) => {
      const cur = rowsOf<Routine & Row>("routines").find((x) => x.routineId === i.routineId);
      if (!cur) throw new Error("no such routine");
      // the server keeps who had it before, so `undo: true` gives it back
      const owner = i.undo === true ? (delegatedFrom.get(i.routineId) ?? cur.ownerId) : i.to?.id ?? cur.ownerId;
      if (i.undo !== true) delegatedFrom.set(i.routineId, cur.ownerId);
      const next = { ...cur, ownerId: owner } as Routine & Row;
      replica.put("routines", [next]);
      return { routine: strip(next, []) };
    },
    "agents.routine.delete": (i: { routineId: string }) => { replica.remove("routines", [i.routineId]); return { deleted: true }; },
  };

  const nav: RightPaneNav = {
    openThread: (id, how) => void opened.push(`thread:${how}:${id}`),
    openHelper: (id) => void opened.push(`helper:${id}`),
    openComputer: (id) => void opened.push(`computer:${id}`),
    openTerminal: (id) => void opened.push(`terminal:${id}`),
    openFile: (id, how) => void opened.push(`file:${how}:${id}`),
    fillComposer: (text) => { composer.text = text; opened.push("composer"); },
    openSource: (kind, ref) => void opened.push(`source:${kind}:${ref}`),
    openAgentPage: (id) => void opened.push(`agent:${id}`),
    openRoutineFile: (_a, title) => void opened.push(`routine-file:${title}`),
    skillFromStep: (c, s) => void opened.push(`skill:${c}:${s}`),
  };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };

  const data: ChatRightPaneData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (!w) throw new Error(`no write for ${cap}`);
      return w(input);
    },
    connection,
    threadId: personal ? "m1" : "c1",
    agent: { agentId, name: agentName, ...(personal ? {} : { computerId: COMPUTER }) },
    space: { name: personal ? "Personal" : "Northwind", personal },
    nav,
    clock: () => ({ now: SAMPLE_NOW, offsetMin: 0 }),
    people: [
      { id: "usr_omar", name: "Omar Haddad", sub: "Owner" },
      { id: "usr_irfad", name: "Irfad Imtiaz", sub: "Admin" },
      { id: "usr_maya", name: "Maya Chen", sub: "Intake lead" },
    ],
  };
  return {
    data, replica, calls, opened, composer,
    setOnline(v) { online = v; for (const l of [...listeners]) l(); },
    failNext(cap) { failing.add(cap); },
  };
}
