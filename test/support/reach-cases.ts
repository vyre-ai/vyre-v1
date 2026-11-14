// The cases of the "made for me, usable by the maker" sweep (owner rule, 14 Nov 2026). Each case is one kind of thing an agent makes or is given for a person: the person's Assistant makes it, reads it, uses it,
// changes it and removes it on the first call; the person looks where they would look; a person with no part in it looks too. A case says what a peer may see: "private" (only the person), "space" (the Space by design).
import { readFileSync } from "node:fs";
import { find, record, row, said, type Reach, type Step, type Who, type ToolOut } from "./reach-kit.ts";

/** A value from a tool's answer, or a throw (the step is skipped: what it needed was never made). */
export const g = (o: any, p: string): any => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const v = p.split(".").reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);
  if (v === undefined || v === null) throw new Error(`no ${p}`);
  return v;
};
export const PERSON: Record<Who, string> = { owner: "usr_olivia", member: "usr_noah", guest: "usr_tess" };
/** Someone with no part in it: a member who was not asked to share. */
export const OTHER = "usr_sana";
type Out = Record<string, import("./reach-kit.ts").ToolOut>;
const at = (o: Out, k: string, p: string): string | undefined => {
  try {
    return g(o[k]?.json, p) as string;
  } catch {
    return undefined;
  }
};

export interface Spec {
  id: string;
  /** what the case tests, in a line */
  what: string;
  steps: (r: Reach, who: Who) => Step[];
  /** the person looks where they would; a peer looks too */
  look?: (o: Out, who: Who) => { cap: string; input: Record<string, unknown> } | null;
}

const mk = (k: string, tool: string, input: Step["input"]): Step => ({ k, tool, input });

export const CASES: Spec[] = [
  {
    id: "note",
    what: "a note the Assistant keeps for the person",
    steps: (r, who) => [
      mk("make", "notes_create", () => ({ title: `note ${who}`, body: "kept" })),
      mk("read", "notes_get", (o) => ({ noteId: g(o["make"]?.json, "note.noteId") })),
    ],
    look: (o) =>
      at(o, "make", "note.noteId") ? { cap: "notes.get", input: { noteId: at(o, "make", "note.noteId")! } } : null,
  },
  {
    id: "record",
    what: "a record (a Contact) the Assistant adds",
    steps: (r, who) => [
      mk("make", "records_create", () => ({ type: "contact", fields: { name: `Ada ${who}` } })),
      mk("read", "records_get", (o) => ({ type: "contact", recordId: g(o["make"]?.json, "record.id") })),
      mk("change", "records_update", (o) => ({
        type: "contact",
        recordId: g(o["make"]?.json, "record.id"),
        patch: { name: "Ada L" },
      })),
      mk("remove", "records_delete", (o) => ({ type: "contact", recordId: g(o["make"]?.json, "record.id") })),
    ],
    look: (o) =>
      at(o, "make", "record.id")
        ? { cap: "records.get", input: { type: "contact", recordId: at(o, "make", "record.id")! } }
        : null,
  },
  {
    id: "task",
    what: "a task the Assistant makes for the person",
    steps: (r, who) => [
      mk("make", "tasks_create", () => ({ title: `task ${who}`, assigned: { kind: "person", id: PERSON[who] } })),
      mk("read", "tasks_get", (o) => ({ taskId: g(o["make"]?.json, "task.id") })),
      mk("change", "tasks_assign", (o) => ({
        taskId: g(o["make"]?.json, "task.id"),
        slot: "assigned",
        to: { kind: "person", id: PERSON[who] },
      })),
    ],
    look: (o) => (at(o, "make", "task.id") ? { cap: "tasks.get", input: { taskId: at(o, "make", "task.id")! } } : null),
  },
  {
    id: "site",
    what: "a site the Assistant creates",
    steps: (r, who) => [
      mk("make", "sites_create", () => ({ name: `site ${who}`, kind: "site" })),
      mk("read", "sites_get", (o) => ({ siteId: g(o["make"]?.json, "site.siteId") })),
      mk("change", "sites_update", (o) => ({ siteId: g(o["make"]?.json, "site.siteId"), name: `site ${who} 2` })),
      mk("remove", "sites_delete", (o) => ({ siteId: g(o["make"]?.json, "site.siteId") })),
    ],
    look: (o) =>
      at(o, "make", "site.siteId") ? { cap: "sites.get", input: { siteId: at(o, "make", "site.siteId")! } } : null,
  },
  {
    id: "artifact",
    what: "an artifact (a page) the Assistant publishes",
    steps: (r, who) => [
      mk("make", "artifact_publish", () => ({ title: `page ${who}`, html: "<!doctype html><h1>hi</h1>" })),
      mk("read", "sites_get", (o) => ({ siteId: g(o["make"]?.json, "artifactId") })),
      mk("change", "artifact_publish", (o) => ({
        artifactId: g(o["make"]?.json, "artifactId"),
        title: `page ${who} 2`,
        html: "<!doctype html><h1>two</h1>",
      })),
      mk("remove", "sites_delete", (o) => ({ siteId: g(o["make"]?.json, "artifactId") })),
    ],
    look: (o) =>
      at(o, "make", "artifactId") ? { cap: "sites.get", input: { siteId: at(o, "make", "artifactId")! } } : null,
  },
  {
    id: "automation",
    what: "an automation the Assistant builds",
    steps: (r, who) => [
      mk("make", "automations_create", () => ({ name: `auto ${who}`, description: "a test" })),
      mk("read", "automations_get", (o) => ({ automationId: g(o["make"]?.json, "automation.id") })),
      mk("change", "automations_update", (o) => ({
        automationId: g(o["make"]?.json, "automation.id"),
        name: `auto ${who} 2`,
      })),
      mk("remove", "automations_delete", (o) => ({ automationId: g(o["make"]?.json, "automation.id") })),
    ],
    look: (o) => {
      const id = at(o, "make", "automation.id");
      return id ? { cap: "automations.get", input: { automationId: id } } : null;
    },
  },
  {
    id: "routine",
    what: "a routine the Assistant sets for itself",
    steps: (r, who) => [
      mk("make", "agents_routine_save", () => ({
        agentId: r.assistant(who),
        title: "morning",
        prompt: "check",
        cron: "0 9 * * *",
      })),
      mk("read", "agents_routines_list", () => ({ agentId: r.assistant(who) })),
      mk("remove", "agents_routine_delete", (o) => ({
        agentId: r.assistant(who),
        routineId: g(o["make"]?.json, "routine.routineId"),
      })),
    ],
  },
  {
    id: "channel",
    what: "an invite-only channel the Assistant opens",
    steps: (r, who) => [
      mk("make", "channels_create", () => ({ name: `chan ${who}`, visibility: "invite" })),
      mk("read", "channels_get", (o) => ({ channelId: g(o["make"]?.json, "channel.channelId") })),
      mk("change", "channels_update", (o) => ({ channelId: g(o["make"]?.json, "channel.channelId"), topic: "t" })),
      mk("remove", "channels_archive", (o) => ({ channelId: g(o["make"]?.json, "channel.channelId") })),
    ],
    look: (o) => {
      const id = at(o, "make", "channel.channelId");
      return id ? { cap: "channels.get", input: { channelId: id } } : null;
    },
  },
  {
    id: "form",
    what: "a form the Assistant builds",
    steps: (r, who) => [
      mk("make", "forms_create", () => ({ kind: "public", name: `form ${who}`, recordType: "contact" })),
      mk("read", "forms_get", (o) => ({ formId: g(o["make"]?.json, "form.formId") })),
      mk("remove", "forms_delete", (o) => ({ formId: g(o["make"]?.json, "form.formId") })),
    ],
    look: (o) => {
      const id = at(o, "make", "form.formId");
      return id ? { cap: "forms.get", input: { formId: id } } : null;
    },
  },
  {
    id: "memory",
    what: "a memory the Assistant keeps about the person",
    steps: (r, who) => [
      mk("make", "memory_remember", () => ({ text: `${who} likes tea`, layer: "person" })),
      mk("read", "memory_search", () => ({ q: "tea" })),
    ],
  },
  {
    id: "skill",
    what: "a skill the Assistant saves for the person (Mine)",
    steps: (r, who) => [
      mk("make", "skills_mine_add", () => ({ text: `---\nname: skill-${who}\ndescription: d\n---\nDo it.` })),
      mk("read", "skills_view", (o) => ({ skillId: g(o["make"]?.json, "skill.skillId") })),
      mk("change", "skills_mine_set", (o) => ({ skillId: g(o["make"]?.json, "skill.skillId"), enabled: true })),
      mk("remove", "skills_mine_remove", (o) => ({ skillId: g(o["make"]?.json, "skill.skillId") })),
    ],
    look: (o) =>
      at(o, "make", "skill.skillId")
        ? { cap: "skills.view", input: { skillId: at(o, "make", "skill.skillId")! } }
        : null,
  },
  {
    id: "memory-page",
    what: "a memory page the Assistant writes about the person",
    steps: (r, who) => [
      mk("make", "memory_write_page", () => ({
        title: `Page ${who}`,
        notes: "likes tea",
        layer: "person",
        kind: "person",
      })),
      mk("read", "memory_page_list", () => ({ layer: "person" })),
      mk("remove", "memory_page_delete", (o) => ({ pageId: g(o["make"]?.json, "page.pageId") })),
    ],
  },
  {
    id: "mcp-connection",
    what: "an MCP connection the Assistant adds for the person (Mine)",
    steps: (r, who) => [
      mk("make", "plugins_connection_add_mine", () => ({ name: `mcp-${who}`, url: "https://example.invalid/mcp" })),
    ],
  },
  {
    id: "project",
    what: "a project the Assistant opens for the person",
    steps: (r, who) => [
      mk("make", "projects_create", () => ({ type: "project", title: `Project ${who}` })),
      mk("read", "projects_get", (o) => ({ projectId: g(o["make"]?.json, "projectId") })),
      mk("remove", "projects_archive", (o) => ({ projectId: g(o["make"]?.json, "projectId") })),
    ],
    look: (o) =>
      at(o, "make", "projectId") ? { cap: "projects.get", input: { projectId: at(o, "make", "projectId")! } } : null,
  },
  {
    id: "vault-mine",
    what: "a Mine folder and a key in it that the Assistant makes",
    steps: (r, who) => [
      mk("make folder", "vault_folders_create", () => ({ name: `Mine ${who}`, scope: "mine" })),
      mk("make", "vault_item_put", (o) => ({
        folderId: g(o["make folder"]?.json, "folder.id"),
        name: "k",
        kind: "api_key",
        fields: [{ key: "api_key", value: "v-123" }],
      })),
      mk("read", "vault_item_get", (o) => ({ itemId: g(o["make"]?.json, "item.id") })),
      mk("change", "vault_item_update", (o) => ({ itemId: g(o["make"]?.json, "item.id"), name: "k2" })),
      mk("remove", "vault_item_delete", (o) => ({ itemId: g(o["make"]?.json, "item.id") })),
    ],
    look: (o) =>
      at(o, "make", "item.id") ? { cap: "vault.item.get", input: { itemId: at(o, "make", "item.id")! } } : null,
  },
  {
    id: "vault-shared",
    what: "a shared folder and a key in it that the Assistant makes",
    steps: (r, who) => [
      mk("make folder", "vault_folders_create", () => ({ name: `Shared ${who}`, scope: "shared" })),
      mk("make", "vault_item_put", (o) => ({
        folderId: g(o["make folder"]?.json, "folder.id"),
        name: "k",
        kind: "api_key",
        fields: [{ key: "api_key", value: "v-123" }],
      })),
      mk("read", "vault_item_get", (o) => ({ itemId: g(o["make"]?.json, "item.id") })),
    ],
    look: (o) =>
      at(o, "make", "item.id") ? { cap: "vault.item.get", input: { itemId: at(o, "make", "item.id")! } } : null,
  },
  {
    id: "connector",
    what: "a connector the Assistant drafts, then a connection to it with a key it put in the Vault",
    steps: (r, who) => [
      mk("make key folder", "vault_folders_create", () => ({ name: `Keys ${who}`, scope: "shared" })),
      mk("make key", "vault_item_put", (o) => ({
        folderId: g(o["make key folder"]?.json, "folder.id"),
        name: `reach key ${who}`,
        kind: "api_key",
        fields: [{ key: "api_key", value: "v-123" }],
      })),
      mk("make", "connectors_init", () => ({ key: `reach_${who}`, title: `Reach ${who}`, mode: "api" })),
      mk("define", "connectors_define", () => ({
        key: `reach_${who}`,
        domains: ["example.invalid"],
        auth: { type: "api_key", header: "x-key", secret: "KEY" },
        secrets: [{ name: "KEY", description: "the key" }],
        actions: [{ name: "ping", method: "GET", url: "https://example.invalid/ping" }],
      })),
      mk("read", "connectors_get", () => ({ key: `reach_${who}` })),
      mk("make connection", "connections_create", (o) => ({
        connector: `reach_${who}`,
        ownerKind: "person",
        title: `conn ${who}`,
        secrets: { KEY: `#${g(o["make key"]?.json, "item.handle")}` },
      })),
      mk("read connection", "connections_get", (o) => ({
        connectionId: g(o["make connection"]?.json, "connection.connectionId"),
      })),
      mk("change", "connections_update", (o) => ({
        connectionId: g(o["make connection"]?.json, "connection.connectionId"),
        title: "renamed",
      })),
      mk("remove", "connections_delete", (o) => ({
        connectionId: g(o["make connection"]?.json, "connection.connectionId"),
      })),
    ],
    look: (o) => {
      const id = at(o, "make connection", "connection.connectionId");
      return id ? { cap: "connections.get", input: { connectionId: id } } : null;
    },
  },
  {
    id: "goal",
    what: "a goal the Assistant sets for the person",
    steps: (r, who) => [
      mk("make", "goals_create", () => ({
        title: `Goal ${who}`,
        deadline: Date.now() + 7 * 86_400_000,
        finish: { kind: "owner", line: "I say it is done" },
        leadAgentId: r.assistant(who),
      })),
      mk("read", "goals_get", (o) => ({ goalId: g(o["make"]?.json, "goal.id") })),
      mk("change", "goals_pause", (o) => ({ goalId: g(o["make"]?.json, "goal.id") })),
    ],
    look: (o) => (at(o, "make", "goal.id") ? { cap: "goals.get", input: { goalId: at(o, "make", "goal.id")! } } : null),
  },
  {
    id: "sheet",
    what: "a spreadsheet the Assistant makes in its own folder",
    steps: (r, who) => [
      mk("home", "agents_get", () => ({ agentId: r.assistant(who) })),
      mk("make", "sheets_create", (o) => ({
        columns: ["a", "b"],
        folderId: g(o["home"]?.json, "agent.folderId"),
        format: "csv",
        name: `rows ${who}`,
      })),
      mk("read", "sheets_read_rows", (o) => ({ fileId: g(o["make"]?.json, "file.fileId") })),
    ],
    look: (o) =>
      at(o, "make", "file.fileId")
        ? { cap: "files.read", input: { fileId: at(o, "make", "file.fileId")!, as: "text" } }
        : null,
  },
  ...(["personal", "space", "agent-home"] as const).map(
    (where): Spec => ({
      id: `files-${where}`,
      what: `a folder and a file the Assistant makes in ${where === "personal" ? "the person's Personal files" : where === "space" ? "a Space folder (People)" : "its own folder"}`,
      steps: (r, who) => [
        mk("tree", "files_tree", () => ({})),
        mk("space", "files_list", () => ({ section: "space" })),
        mk("home", "agents_get", () => ({ agentId: r.assistant(who) })),
        mk("make folder", "files_folder_create", (o) => ({
          parentId:
            where === "personal"
              ? g(
                  find(o["tree"]?.json, (x) => x["key"] === "personal"),
                  "folderId",
                )
              : where === "space"
                ? g(
                    find(o["space"]?.json, (x) => x["name"] === "People" && x["folderId"]),
                    "folderId",
                  )
                : g(o["home"]?.json, "agent.folderId"),
          name: `made ${who} ${where}`,
        })),
        mk("make", "files_create", (o) => ({
          folderId: g(o["make folder"]?.json, "folder.folderId"),
          name: "a.md",
          content: { text: "hello" },
        })),
        mk("read", "files_read", (o) => ({ fileId: g(o["make"]?.json, "file.fileId"), as: "text" })),
        mk("change", "files_write", (o) => ({
          fileId: g(o["make"]?.json, "file.fileId"),
          content: { text: "changed" },
        })),
        mk("remove", "files_delete", (o) => ({ fileId: g(o["make"]?.json, "file.fileId") })),
      ],
      look: (o) =>
        at(o, "make", "file.fileId")
          ? { cap: "files.read", input: { fileId: at(o, "make", "file.fileId")!, as: "text" } }
          : null,
    }),
  ),
  {
    id: "calendar",
    what: "an event the Assistant puts on the person's calendar",
    steps: (r, who) => [
      mk("cals", "calendar_list_calendars", () => ({})),
      mk("make", "calendar_create_event", (o) => ({
        calendarId: g(
          find(o["cals"]?.json, (x) => x["personal"] === true),
          "id",
        ),
        title: `event ${who}`,
        startsAt: Date.now() + 86_400_000,
        endsAt: Date.now() + 90_000_000,
      })),
      mk("read", "calendar_get_event", (o) => ({ eventId: g(o["make"]?.json, "event.id") })),
      mk("remove", "calendar_delete_event", (o) => ({ eventId: g(o["make"]?.json, "event.id") })),
    ],
    look: (o) =>
      at(o, "make", "event.id") ? { cap: "calendar.get_event", input: { eventId: at(o, "make", "event.id")! } } : null,
  },
  {
    id: "computer",
    what: "a computer the Assistant is given",
    steps: (r, who) => [
      mk("make", "computers_provision", () => ({ agentId: r.assistant(who) })),
      mk("read", "computers_get", (o) => ({ computerId: g(o["make"]?.json, "computer.computerId") })),
    ],
  },
];

/** Run a case for one person: the chain up to the removal, what the person and a peer see, then the removal in a chain of its own (the thing is gone after it). */
export async function runCase(r: Reach, who: Who, spec: Spec): Promise<Record<string, string>> {
  const steps = spec.steps(r, who);
  const rest = steps.filter((s) => s.k !== "remove");
  const removal = steps.filter((s) => s.k === "remove");
  const outs = await r.chain(who, rest);
  const look = spec.look?.(outs, who) ?? null;
  row({ case: spec.id, who, step: "what", result: spec.what });
  const seen = await record(
    r,
    {
      id: spec.id,
      who,
      outs,
      order: rest.map((s) => s.k).filter((k) => !["cals", "tree", "space", "home"].includes(k)),
    },
    spec.look
      ? [
          { k: "person sees", who, cap: look?.cap ?? "", input: look?.input ?? null },
          { k: "other sees", who: OTHER, cap: look?.cap ?? "", input: look?.input ?? null },
        ]
      : [],
  );
  if (removal.length) {
    // the removal runs on what the first chain returned: its steps read the earlier answers through a chain that begins with them
    const again = await r.chain(
      who,
      [...rest.map((s) => ({ k: s.k, tool: "", input: () => null }) as Step), ...removal],
      outs,
    );
    Object.assign(seen, await record(r, { id: spec.id, who, outs: again, order: removal.map((s) => s.k) }));
  }
  return seen;
}

const TOOLS = JSON.parse(readFileSync(new URL("../../generated/mcp-tools.json", import.meta.url), "utf8")) as
  | Array<{ name: string; cap: string }>
  | { tools: Array<{ name: string; cap: string }> };
const TOOL_CAP: Record<string, string> = Object.fromEntries(
  (Array.isArray(TOOLS) ? TOOLS : TOOLS.tools).map((t) => [t.name, t.cap]),
);

/** The same steps made by the person themself over the API: what a peer sees of a thing the person made is the baseline an agent-made thing must not be wider than. */
export async function runBaseline(r: Reach, who: Who, spec: Spec): Promise<void> {
  const steps = spec.steps(r, who).filter((s) => s.k !== "remove");
  const outs: Record<string, ToolOut> = {};
  for (const st of steps) {
    let input: Record<string, unknown> | null = null;
    try {
      input = st.input(outs);
    } catch {
      input = null;
    }
    const cap = TOOL_CAP[st.tool];
    if (input === null || !cap) continue;
    const x = await r.as(who, cap, input);
    const data = (x.data as { data?: unknown }).data ?? x.data;
    outs[st.k] = { ok: x.status === 200, text: JSON.stringify(x.data), json: data };
  }
  const look = spec.look?.(outs, who) ?? null;
  if (!look) return;
  const own = await r.as(who, look.cap, look.input);
  const peer = await r.as(OTHER, look.cap, look.input);
  row({ case: spec.id, who, step: "person-made: person sees", result: own.status === 200 ? "ok" : `${own.status}` });
  row({ case: spec.id, who, step: "person-made: other sees", result: peer.status === 200 ? "ok" : `${peer.status}` });
  void said;
}
