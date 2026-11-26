// terminal (lane L2): tmux sessions on the agent computer, the Space server or a person's computer. Spec 2.7; ARCHITECTURE-V1.md 6.7, 6.11, 7.2.
// Sessions are tmux sessions (no native pty dependency); the module attaches in control mode and relays output as live frames, so a session
// survives its tab and an agent command shows as one step with Open terminal attaching the same session.
// DECISION: a terminal is bound to the Space resource at open time (the host may be a computer or a device); afterwards every capability
//   is bound to the terminal resource. Opening on an agent computer needs a Team Space; the handler refuses it in a Personal Space.
// DECISION: terminal.run is bound to the Space, like terminal.open: with no terminalId it runs in the agent's own session where the turn runs (opened on first use), and a terminalId it
//   names is checked by the handler at Use on that terminal, as the pipeline checked it before (owner 2 Nov: an agent's terminal_run with no terminal was refused before it reached the handler).
// DECISION: allow, ask and deny rules are per person per Space; an Ask rule parks the turn (turn.waiting) with a request in Needs you.
//   Ask, Allow and Auto never loosen the Gate.
// DECISION: Starred terminals are `stars` rows owned by module spaces; terminal.status gives Home the live status it shows.
// Secrets appear in commands only as #Handle.field; the executing process substitutes the value and scrubs the output (ARCHITECTURE-V1.md 6.11).
import {
  block,
  create,
  defineManifest,
  ev,
  health,
  list,
  read,
  screen,
  t,
  write,
} from "../packages/contracts/src/index.ts";
import { id, pageIn, pageOut } from "./_common.ts";

const host = t.enm("agent_computer", "space_server", "device");
const termState = t.enm("running", "idle", "exited");
const terminalRow = t.obj({
  terminalId: id.terminal,
  name: t.str({ examples: ["build"] }),
  host,
  hostTitle: t.str({ examples: ["Intake's computer"] }),
  agentId: t.opt(id.agent),
  computerId: t.opt(id.computer),
  deviceId: t.opt(id.device),
  cwd: t.str(),
  state: termState,
  exitCode: t.nullable(t.int()),
  named: t.bool(),
  cols: t.int(),
  rows: t.int(),
  createdAt: t.ts(),
  lastActiveAt: t.ts(),
  runId: t.opt(id.run),
  by: t.opt(
    t.obj(
      { kind: t.enm("agent", "helper", "person"), name: t.opt(t.str({ examples: ["Ember"] })) },
      {
        description:
          "Whose tab it is in a workspace: the agent itself, a helper or crew member it started (by name), or a person who opened it",
      },
    ),
  ),
  // the person at the keyboard now: the agent's commands and everyone else's keys are refused until they hand it back (or 15 minutes pass with nobody using it)
  heldBy: t.opt(id.user),
  // the person who opened it: a person's own tab says whose it is
  ownerId: t.opt(id.user),
  // true on a row that only says a terminal of someone else's is there (no folder, chat, name or holder): the app counts these and draws none of them
  elsewhere: t.opt(t.bool()),
  // the chat it was opened from, when it was opened from one (a background job line in that chat reads it)
  threadId: t.opt(id.thread),
});
const captureOut = t.obj({
  text: t.str(),
  cols: t.int(),
  rows: t.int(),
  cursor: t.nullable(t.obj({ x: t.int(), y: t.int() })),
  history: t.int(),
  hidden: t.bool(),
});
const command = t.obj({
  command: t.str(),
  exitCode: t.nullable(t.int()),
  startedAt: t.ts(),
  durationMs: t.opt(t.int()),
});
const rules = t.obj({ allow: t.arr(t.str()), ask: t.arr(t.str()), deny: t.arr(t.str()), folders: t.arr(id.folder) });
const target = { terminalId: id.terminal };
const listIn = {
  section: t.opt(t.enm("personal", "shared", "space")),
  folderId: t.opt(id.folder),
  host: t.opt(host),
  state: t.opt(t.arr(termState)),
  ...pageIn,
};

const jobRow = t.obj({
  jobId: t.str({ pattern: "^job_[a-f0-9]{12}$", examples: ["job_a1b2c3d4e5f6"] }),
  name: t.str(),
  command: t.str(),
  state: t.enm("starting", "running", "restarting", "stopped", "done", "failed"),
  restart: t.enm("on-failure", "always", "never"),
  startedAt: t.opt(t.ts()),
  restarts: t.int(),
  exitCode: t.opt(t.nullable(t.int())),
  lastLine: t.opt(t.str({ description: "The last line the job printed" })),
});

export default defineManifest({
  id: "terminal",
  title: "Terminal",
  owner: "L2",
  lists: [list("terminal", "Terminal", "Terminals", "terminal.list")],
  capabilities: [
    read("terminal.list", "List terminal sessions you can see, including named leftover scripts", {
      in: listIn,
      out: { terminals: t.arr(terminalRow), ...pageOut },
      tool: "terminal",
      label: "filter",
      cli: "vyre terminal list",
    }),
    read(
      "terminal.workspace",
      "An agent's workspace as the Terminal tab shows it: asleep, running, waiting for room (with the line) or not made yet, where it is, whether you may attach and why not; with no machine to run it, one plain line",
      {
        in: { agentId: id.agent },
        out: {
          state: t.enm("running", "asleep", "waiting", "none", "unavailable"),
          line: t.opt(t.str({ description: "Waiting: the room line. Unavailable: why, and what to do" })),
          host: t.opt(t.enm("space", "server")),
          nodeId: t.opt(t.str()),
          projects: t.opt(t.arr(id.project)),
          canAttach: t.bool(),
          cannotAttach: t.opt(t.str({ description: "Why not, as one sentence" })),
          takeOver: t.opt(
            t.bool({
              description:
                "Whether a person may take the keyboard of a terminal here (on by default; the Space server's VYRE_TERMINAL_TAKEOVER=0 turns it off). When false the app draws a watching view and no Take over",
            }),
          ),
          ownPlace: t.opt(
            t.bool({
              description:
                "True when this person works in a place of their own on a shared agent's computer (they do not own the agent): the tab says it is theirs and shows the terminals of others only as a count",
            }),
          ),
        },
        tool: "terminal",
        label: "check",
      },
    ),
    read("terminal.get", "Read one terminal session: host, state, working folder, last exit code", {
      in: target,
      out: { terminal: terminalRow },
      on: ["terminal", "/terminalId"],
      tool: "terminal",
      errors: ["validation.not_found"],
    }),
    read("terminal.status", "Live status of terminals for Home (state and last line read from tmux)", {
      in: { terminalIds: t.arr(id.terminal, { maxItems: 50 }) },
      out: {
        rows: t.arr(
          t.obj({
            terminalId: id.terminal,
            state: termState,
            lastLine: t.opt(t.str()),
            lastCommand: t.opt(t.str()),
            exitCode: t.nullable(t.int()),
          }),
        ),
      },
      tool: "terminal",
      label: "filter",
    }),
    create(
      "terminal.open",
      "Open a terminal tab: a named tmux session in your workspace (an agent that names no host gets one in its own workspace, or its parent's when it is a helper), or on your own computer (the device daemon)",
      {
        in: {
          host: t.opt(t.enm("agent_computer", "device")),
          agentId: t.opt(id.agent),
          computerId: t.opt(id.computer),
          deviceId: t.opt(id.device),
          name: t.opt(
            t.str({
              description:
                "The tab's name, such as build or tests; a helper's tab is named for the helper when left out",
            }),
          ),
          cwd: t.opt(t.str()),
          cols: t.opt(t.int({ minimum: 20, maximum: 500 })),
          rows: t.opt(t.int({ minimum: 5, maximum: 200 })),
          own: t.opt(
            t.bool({
              description:
                "Open the agent's own terminal in its workspace (named agent, its commands land in it), or return the one already there: nobody presses Attach. A person's call only",
            }),
          ),
        },
        out: { terminal: terminalRow },
        perm: "terminal.use",
        emits: ["terminal.opened"],
        tool: "terminal",
        errors: ["permission.needs_team", "permission.no_grant", "provider.unavailable"],
        cli: "vyre terminal open",
      },
    ),
    create(
      "terminal.open_server",
      "Open a shell on the Space server (needs server.services; locked state with Ask for access otherwise)",
      {
        in: {
          name: t.opt(t.str()),
          cwd: t.opt(t.str()),
          cols: t.opt(t.int({ minimum: 20, maximum: 500 })),
          rows: t.opt(t.int({ minimum: 5, maximum: 200 })),
        },
        out: { terminal: terminalRow },
        perm: "server.services",
        level: "manage",
        risk: "high",
        audit: "always",
        emits: ["terminal.opened"],
        tool: "terminal",
      },
    ),
    write("terminal.rename", "Name a session so it can be found and starred (leftover scripts become named sessions)", {
      in: { ...target, name: t.str() },
      out: { terminal: terminalRow },
      on: ["terminal", "/terminalId"],
      emits: ["terminal.renamed"],
      tool: "terminal",
      offline: "patch",
      errors: ["validation.precondition_failed"],
    }),
    write("terminal.close", "Close a session and kill its tmux session", {
      in: target,
      out: { closed: t.bool() },
      on: ["terminal", "/terminalId"],
      level: "edit",
      emits: ["terminal.closed"],
      tool: "terminal",
      idem: "natural",
      offline: "online",
      errors: ["validation.precondition_failed"],
    }),
    write(
      "terminal.input",
      "Send keystrokes to a session (a person typing in the terminal tab; output returns as live frames)",
      {
        in: { ...target, data: t.str() },
        out: { ok: t.bool() },
        on: ["terminal", "/terminalId"],
        level: "use",
        tool: "terminal",
        idem: "none",
        offline: "online",
        risk: "medium",
        errors: ["validation.precondition_failed"],
        rate: { n: 600, perSeconds: 60, scope: "principal" },
      },
    ),
    write(
      "terminal.take_over",
      "Take the keyboard of a terminal: the agent's commands and everyone else's keys are refused until you hand it back. Only the owner of the terminal or an admin can take it from another person",
      {
        in: target,
        out: {
          terminal: terminalRow,
          lease: t.opt(
            t.str({
              description:
                "This take-over's lease: every batch of keys carries it, and a batch of an older take-over is refused",
            }),
          ),
          nextSeq: t.opt(
            t.int({
              description: "The number the next batch of keys of this take-over carries (1 for a new take-over)",
            }),
          ),
        },
        on: ["terminal", "/terminalId"],
        level: "use",
        emits: ["terminal.taken"],
        audit: "always",
        idem: "natural",
        offline: "online",
        errors: ["permission.no_grant", "permission.role_lacks_permission"],
      },
    ),
    write("terminal.give_back", "Hand the keyboard of a terminal back to the agent", {
      audit: "always",
      in: target,
      out: { terminal: terminalRow },
      on: ["terminal", "/terminalId"],
      level: "use",
      emits: ["terminal.given_back"],
      idem: "natural",
      offline: "online",
      errors: ["permission.no_grant", "permission.role_lacks_permission"],
    }),
    read(
      "terminal.capture",
      "The screen of a session as tmux draws it, with its colours (escape sequences), the cursor, how much history there is, and whether a program is reading a hidden prompt (secrets already scrubbed)",
      {
        in: { ...target, lines: t.opt(t.int({ minimum: 1, maximum: 5000 })) },
        out: {
          text: t.str(),
          cols: t.int(),
          rows: t.int(),
          cursor: t.nullable(t.obj({ x: t.int(), y: t.int() })),
          history: t.int(),
          hidden: t.bool(),
        },
        on: ["terminal", "/terminalId"],
        label: "check",
        offline: "online",
        errors: ["validation.not_found", "validation.precondition_failed"],
      },
    ),
    write(
      "terminal.keys",
      "Press keys in a session as a person at a keyboard does: text, a named key (Enter, Tab, Up, C-c, F5 ...) or a paste as one write, raw through tmux; for a person who holds the keyboard. Never stored or logged: what is typed at a hidden prompt does not reach the stored log, other viewers or the agent",
      {
        in: {
          ...target,
          keys: t.arr(t.obj({ text: t.opt(t.str()), key: t.opt(t.str()), paste: t.opt(t.str()) }), {
            minItems: 1,
            maxItems: 200,
          }),
          lease: t.str({
            description: "The lease terminal.take_over answered: a batch of an older take-over is refused",
          }),
          seq: t.int({
            minimum: 1,
            description:
              "This batch's number in the take-over, from the take_over answer's nextSeq: applied in order, at most once, a gap refused",
          }),
          // answer with the screen a moment after the keys landed (what terminal.capture says), so a key shows in one round trip
          capture: t.opt(t.bool()),
        },
        out: { ok: t.bool(), screen: t.opt(captureOut) },
        on: ["terminal", "/terminalId"],
        level: "use",
        audit: "always",
        idem: "key",
        offline: "online",
        risk: "medium",
        rate: { n: 3000, perSeconds: 60, scope: "principal" },
        errors: ["permission.no_grant", "validation.bad_input", "validation.precondition_failed"],
      },
    ),
    write("terminal.interrupt", "Send Ctrl-C to a session", {
      in: target,
      out: { ok: t.bool() },
      on: ["terminal", "/terminalId"],
      level: "use",
      tool: "terminal",
      idem: "none",
      offline: "online",
      risk: "low",
      errors: ["validation.precondition_failed"],
    }),
    write("terminal.resize", "Resize the terminal window", {
      in: { ...target, cols: t.int({ minimum: 20, maximum: 500 }), rows: t.int({ minimum: 5, maximum: 200 }) },
      out: { ok: t.bool() },
      on: ["terminal", "/terminalId"],
      level: "use",
      idem: "natural",
      offline: "online",
      risk: "low",
      errors: ["validation.precondition_failed"],
      tool: "terminal",
    }),
    read("terminal.read", "Read the scrollback of a session (secrets already scrubbed)", {
      in: { ...target, lines: t.opt(t.int({ minimum: 1, maximum: 5000 })), since: t.opt(t.int()) },
      out: { text: t.str(), next: t.int() },
      on: ["terminal", "/terminalId"],
      tool: "terminal",
      label: "check",
    }),
    read(
      "terminal.log.list",
      "The commands of a terminal, newest first, and whether the output of each is still kept (a week after it ended)",
      {
        in: { ...target, limit: t.opt(t.int({ minimum: 1, maximum: 200 })) },
        out: {
          commands: t.arr(
            t.obj({
              commandId: t.int({ description: "The command's own number: terminal.log.read takes it" }),
              command: t.str({
                description: "As the model wrote it (Vault handles, never values), at most 300 characters",
              }),
              exitCode: t.nullable(t.int()),
              startedAt: t.ts(),
              durationMs: t.opt(t.int()),
              kept: t.bool(),
              bytes: t.int(),
              cutBytes: t.opt(t.int({ description: "How much of the start was dropped to fit the per-command cap" })),
            }),
          ),
        },
        on: ["terminal", "/terminalId"],
        tool: "terminal",
        label: "check",
      },
    ),
    read(
      "terminal.log.read",
      "Part of what one command printed, scrubbed: the last lines, the lines that contain words (with context), or a range of lines; never the whole output",
      {
        in: {
          ...target,
          commandId: t.int({ description: "From terminal.run's answer or terminal.log.list" }),
          tail: t.opt(t.int({ minimum: 1, maximum: 400 })),
          match: t.opt(t.arr(t.str({ maxLength: 100 }), { maxItems: 5 })),
          context: t.opt(t.int({ minimum: 0, maximum: 5 })),
          from: t.opt(t.int({ minimum: 1 })),
          to: t.opt(t.int({ minimum: 1 })),
        },
        out: {
          lines: t.arr(t.obj({ n: t.int({ description: "Line number, 1-based" }), text: t.str() })),
          totalLines: t.int(),
          bytes: t.int(),
          cutBytes: t.int(),
          exitCode: t.nullable(t.int()),
          more: t.bool({
            description: "More lines matched than this answer holds: ask for a narrower range or other words",
          }),
        },
        on: ["terminal", "/terminalId"],
        tool: "terminal",
        label: "check",
        errors: ["validation.not_found"],
      },
    ),
    read(
      "terminal.attach",
      "Attach to a session as a live stream; the same session an agent used, so Open terminal shows its commands",
      {
        in: target,
        out: { ticket: t.str(), expiresAt: t.ts(), replay: t.str() },
        on: ["terminal", "/terminalId"],
        level: "view",
        tool: "terminal",
      },
    ),
    write(
      "terminal.stream",
      "Open a live stream of a session's screen over a WebSocket: changes as they happen, numbered, resumable. Send the ticket as the first message, not in the address. Typing stays terminal.keys",
      {
        in: target,
        out: {
          ws: t.str({ description: "The Space-relative address of the WebSocket (no ticket in it)" }),
          ticket: t.str({ description: "Sent as the first message: {t:hello, ticket, rev}. One use, sixty seconds" }),
          expiresAt: t.ts(),
        },
        on: ["terminal", "/terminalId"],
        level: "view",
        idem: "none",
        audit: "none",
        tool: "terminal",
        errors: ["validation.not_found", "validation.precondition_failed", "permission.role_lacks_permission"],
      },
    ),
    write(
      "terminal.job.start",
      "Keep a command running on your computer as a background job (a server, a watcher, a bot): it is started again if it dies and after a restart, keeps its log, and keeps your computer awake until it ends. Gated like terminal.run",
      {
        in: {
          command: t.str(),
          name: t.opt(t.str({ maxLength: 80, description: "What the person sees in the list. Left out: the command" })),
          cwd: t.opt(t.str()),
          env: t.opt(t.rec(t.str({ description: "A literal value, never a Vault handle" }))),
          // when it ends: start it again after a failure (the default), always, or never
          restart: t.opt(t.enm("on-failure", "always", "never")),
          agentId: t.opt(id.agent),
        },
        out: { job: jobRow },
        level: "use",
        perm: "terminal.use",
        tool: "terminal",
        mcpName: "terminal_job_start",
        gate: { act: "approve", when: "terminal.is_danger(input.command)" },
        agent: { planMode: "blocked", blocks: ["terminal"] },
        idem: "key",
        audit: "sensitive",
        risk: "high",
        offline: "online",
        errors: [
          "permission.needs_approval",
          "permission.role_lacks_permission",
          "validation.bad_input",
          "validation.precondition_failed",
          "internal.unavailable",
        ],
      },
    ),
    write(
      "terminal.job.stop",
      "Stop a background job of your computer; it stays in the list as stopped, with its log",
      {
        in: {
          jobId: t.str({ pattern: "^job_[a-f0-9]{12}$", examples: ["job_a1b2c3d4e5f6"] }),
          agentId: t.opt(id.agent),
        },
        out: { job: jobRow },
        level: "use",
        perm: "terminal.use",
        tool: "terminal",
        mcpName: "terminal_job_stop",
        agent: { planMode: "blocked", blocks: ["terminal"] },
        idem: "natural",
        audit: "sensitive",
        offline: "online",
        errors: [
          "permission.role_lacks_permission",
          "validation.not_found",
          "validation.precondition_failed",
          "internal.unavailable",
        ],
      },
    ),
    read(
      "terminal.job.list",
      "The background jobs of a computer, newest first: running, restarting or ended, how often each restarted, and the last line it printed. Never wakes the computer",
      {
        in: { agentId: t.opt(id.agent) },
        out: { jobs: t.arr(jobRow) },
        level: "view",
        tool: "terminal",
        mcpName: "terminal_job_list",
        errors: ["permission.role_lacks_permission", "validation.precondition_failed", "internal.unavailable"],
      },
    ),
    write(
      "terminal.run",
      "Run a command in a session and wait for it; secrets only as #Handle.field; output is scrubbed",
      {
        in: {
          command: t.str(),
          terminalId: t.opt(id.terminal),
          session: t.opt(
            t.str({
              maxLength: 80,
              description: "Tab name, made when there is none. Left out: your own tab",
            }),
          ),
          host: t.opt(t.enm("agent_computer", "device")),
          agentId: t.opt(id.agent),
          cwd: t.opt(t.str()),
          timeoutSec: t.opt(t.int({ minimum: 1, maximum: 3600 })),
          env: t.opt(t.rec(t.str({ description: "Literal or #Handle.field" }))),
          background: t.opt(
            t.bool({
              description: "Keep a long command running; wait with wait_for on run.node_ended",
            }),
          ),
        },
        out: {
          terminalId: id.terminal,
          commandId: t.opt(
            t.int({
              description:
                "This command's own number: terminal.log.read and terminal.log.list take it, to read part of its output later",
            }),
          ),
          exitCode: t.nullable(t.int()),
          output: t.str(),
          truncated: t.bool(),
          durationMs: t.int(),
        },
        level: "use",
        perm: "terminal.use",
        emits: ["terminal.opened", "terminal.command_finished"],
        tool: "terminal",
        mcpName: "terminal_run",
        gate: { act: "approve", when: "terminal.is_danger(input.command)" },
        agent: { planMode: "blocked", blocks: ["terminal"] },
        idem: "key",
        audit: "sensitive",
        risk: "high",
        offline: "online",
        errors: [
          "permission.needs_approval",
          "timeout.deadline",
          "provider.unavailable",
          "validation.not_found",
          "validation.precondition_failed",
        ],
      },
    ),
    write(
      "terminal.request",
      "Ask the person to run a command themselves (sudo, a login, an interactive install): the chat shows the command, why and its risk, and the person runs it in their terminal, copies it or declines; what it printed comes back to you",
      {
        in: { threadId: id.thread, command: t.str(), why: t.str(), host: t.opt(host) },
        out: { blockId: id.block, messageId: id.message, risk: t.enm("read", "change", "danger") },
        on: ["thread", "/threadId"],
        level: "use",
        tool: "terminal",
        mcpName: "terminal_request",
        agent: { planMode: "allowed", blocks: ["question"] },
        errors: ["permission.role_lacks_permission", "validation.bad_input"],
      },
    ),
    write(
      "terminal.ask_signin",
      "Ask the person to finish a login in your terminal (gh auth login, a vendor CLI): one sign-in card in the chat; people who may take over see Open terminal and Done, others see who you wait for; your turn waits for Done",
      {
        in: {
          threadId: id.thread,
          terminalId: id.terminal,
          why: t.str({ description: "What to sign in to, in a sentence the person understands" }),
        },
        out: { blockId: id.block, messageId: id.message },
        on: ["thread", "/threadId"],
        level: "use",
        tool: "terminal",
        mcpName: "terminal_ask_signin",
        agent: { planMode: "allowed", blocks: ["question"] },
        errors: [
          "permission.no_grant",
          "permission.role_lacks_permission",
          "validation.bad_input",
          "validation.not_found",
          "validation.precondition_failed",
        ],
      },
    ),
    read(
      "terminal.risk",
      "What a command can do before it runs: read-only, changes something or destructive, and what your rules say; red always asks",
      {
        in: { command: t.str() },
        out: {
          risk: t.enm("read", "change", "danger"),
          verdict: t.enm("deny", "ask", "allow", "none"),
          why: t.str(),
          entry: t.opt(t.str()),
        },
        tool: "terminal",
      },
    ),
    read("terminal.rules.get", "Your allow, ask and deny rules and the folders the terminal is locked to", {
      out: { rules },
      tool: "terminal",
    }),
    write(
      "terminal.rules.set",
      "Change your allow, ask and deny rules and the extra folders (a Personal Space terminal is locked to its own folder plus these)",
      {
        in: { rules },
        out: { rules },
        perm: "terminal.use",
        emits: ["terminal.rules_changed"],
        tool: "terminal",
        audit: "sensitive",
        idem: "natural",
        offline: "patch",
      },
    ),
    read("terminal.health", "Health of tmux and the session relay on the host", {
      out: {
        state: t.enm("healthy", "degraded", "down"),
        detail: t.opt(t.str()),
        latencyMs: t.opt(t.int()),
        sessions: t.int(),
      },
    }),
  ],
  events: [
    ev("terminal.opened", "A terminal session was opened", {
      p: { terminalId: id.terminal, host: t.str(), agentId: t.opt(id.agent), by: t.str() },
      subject: ["terminal", "/terminalId"],
      vis: "participants",
    }),
    ev("terminal.closed", "A terminal session was closed", {
      p: { terminalId: id.terminal, by: t.str() },
      subject: ["terminal", "/terminalId"],
      vis: "participants",
    }),
    ev(
      "terminal.taken",
      "A person took the keyboard of a terminal (the agent is told, its commands are refused until it is handed back). When it is someone other than the agent's owner, the payload names the agent and its owner so the owner is told in their chat",
      {
        p: {
          terminalId: id.terminal,
          by: t.str(),
          from: t.opt(t.str()),
          agentId: t.opt(t.str()),
          agentName: t.opt(t.str()),
          agentOwner: t.opt(t.str()),
        },
        subject: ["terminal", "/terminalId"],
        vis: "participants",
      },
    ),
    ev(
      "terminal.given_back",
      "The keyboard of a terminal was handed back to the agent by the person who held it (a hold that ran out after 15 quiet minutes is read as over and emits nothing)",
      {
        p: {
          terminalId: id.terminal,
          by: t.str(),
          agentId: t.opt(t.str()),
          agentName: t.opt(t.str()),
          agentOwner: t.opt(t.str()),
        },
        subject: ["terminal", "/terminalId"],
        vis: "participants",
      },
    ),
    ev("terminal.renamed", "A terminal session was renamed", {
      p: { terminalId: id.terminal, name: t.str() },
      subject: ["terminal", "/terminalId"],
      vis: "participants",
    }),
    ev("terminal.command_finished", "A command finished (exit code and duration only, never the command or output)", {
      p: {
        terminalId: id.terminal,
        exitCode: t.nullable(t.int()),
        durationMs: t.int(),
        by: t.str(),
        runId: t.opt(id.run),
      },
      subject: ["terminal", "/terminalId"],
      vis: "participants",
      retention: "logs",
    }),
    ev("terminal.rules_changed", "A person changed their terminal rules", {
      p: { personId: id.user },
      subject: ["entity", "/personId"],
      vis: "owner",
    }),
  ],
  blocks: [
    block(
      "terminal",
      {
        terminalId: id.terminal,
        title: t.str(),
        host,
        hostTitle: t.str(),
        commands: t.arr(command),
        tail: t.str(),
        state: termState,
        exitCode: t.nullable(t.int()),
      },
      "Ran {{commands.length}} commands on {{hostTitle}}",
      {
        opens: { tab: "terminal", input: { terminalId: "/terminalId" } },
        actions: [
          { key: "interrupt", label: "Interrupt", cap: "terminal.interrupt", input: { terminalId: "/terminalId" } },
          { key: "close", label: "Close", cap: "terminal.close", input: { terminalId: "/terminalId" } },
        ],
      },
    ),
  ],
  health: [
    health(
      "terminal",
      "Terminals",
      "terminal.health",
      "Check that tmux is installed on the host, then reopen the session",
    ),
  ],
  screens: [
    screen("chats.terminal-tab", "chats", "ui:TerminalTab", {
      slot: "tab",
      q: {
        terminal: ["terminal.get", { terminalId: "/state/terminalId" }, true],
        attach: ["terminal.attach", { terminalId: "/state/terminalId" }, false],
      },
      a: {
        input: ["terminal.input", { terminalId: "/state/terminalId" }],
        resize: ["terminal.resize", { terminalId: "/state/terminalId" }],
        interrupt: ["terminal.interrupt", { terminalId: "/state/terminalId" }],
        rename: ["terminal.rename", { terminalId: "/state/terminalId" }],
        close: ["terminal.close", { terminalId: "/state/terminalId" }, "Close this session?"],
      },
      empty: "No session",
      primary: "New terminal",
      needs: ["terminal.use"],
    }),
    screen("chats.terminal-list", "chats", "ui:TerminalList", {
      slot: "popover",
      q: {
        terminals: [
          "terminal.list",
          { section: "/state/section", folderId: "/state/folderId", host: "/state/host" },
          true,
        ],
      },
      a: { open: ["terminal.open", {}], openServer: ["terminal.open_server", {}] },
      empty: "No terminals yet",
      primary: "New terminal",
      needs: ["terminal.use"],
    }),
    screen("chats.terminal-rules", "chats", "ui:TerminalRules", {
      slot: "sheet",
      q: { rules: ["terminal.rules.get", {}, true] },
      a: { save: ["terminal.rules.set", {}] },
      empty: "No rules yet",
      primary: "Add a rule",
      needs: ["terminal.use"],
    }),
  ],
});
