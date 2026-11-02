// What an outside agent may call. There is no scope list: it can use what the person who allowed it can, and the invoke pipeline makes that true on every call (agent and person must both allow, ARCH 4.5 rule 5). This file
// narrows only what the MCP door must never offer the agent itself, and it never widens anything.
//   Off here   the terminal, Vyre computers and every tool that runs on a machine of ours (it has its own machine), and the Vault toolset (a value never leaves, and a handle is no use outside a Vyre turn).
//   A person's own   signing in, devices, members, access, the rules of the Gate, the company's connections and the engineer tools stay with people. An agent cannot allow another client, cannot widen what it was given,
//              and cannot change who gets in. It can ask: the call waits for the person it acts for, runs as them on their yes, and is refused when they cannot do it either (docs/ask-the-person.md).
//   Paste      putting a key in the Vault, or asking for one, is a key request for the name only: the person pastes the value in their own app, and the agent gets the name, never the value or Use on it.
import type { ToolDef } from "../tools/types.ts";

const OFF_TOOLSETS: ReadonlySet<string> = new Set(["vault", "terminal", "computer"]);

/** Families of capability only a person changes. Reading them stays open when the person may read them. */
const PERSON_ONLY: ReadonlySet<string> = new Set(["mcp", "identity", "members", "devices", "access", "gate", "connections", "connectors", "dropbox", "network", "spaces", "updates", "backup", "governance", "billing"]);
/** The company's own connections, inside a family that is otherwise work: a person's tools for the mail in it stay. */
const PERSON_ONLY_CAPS = /^(google|ms|microsoft)\.(dwd|tenant|connect|directory)(\.|_|$)|^settings\.(set_space|floor_set|reset_space|copy_profile|kit\.set_space)$|^agents\.(delete|pause|resume|update|role_line\.set|config\.)/;
/** Asking is never a way past a person: this opens a question they answer. */
const ASKS: ReadonlySet<string> = new Set(["access.request"]);
/** Finding tools is not a power. */
const ALWAYS: ReadonlySet<string> = new Set(["mcp.tool.search", "mcp.tool.describe", "mcp.toolsets.list", "mcp.tools.list"]);

/** A tool that needs a person to press something, whoever else may use it. */
export function isPersonOnly(cap: string, effects: string): boolean {
  if (ASKS.has(cap) || effects === "read") return false;
  const family = cap.split(".")[0] as string;
  return PERSON_ONLY.has(family) || PERSON_ONLY_CAPS.test(cap);
}

/** Where an outside agent's call goes. open: it runs as the agent acting for the person, through the pipeline. ask: it waits for that person, and runs as them on their yes. paste: a key request the person
 *  fills in their own app. off: never from outside. */
export type OutsideDoor = "open" | "ask" | "paste" | "off";

/** The Vault's one door from outside: asking for a key by name, and always for the name only (never Use on it). A person pastes the value in their own app; it never reaches the agent. */
const VAULT_PASTE: ReadonlySet<string> = new Set(["vault.item.put", "vault.request"]);

export function outsideDoor(t: Pick<ToolDef, "cap" | "toolset" | "effects" | "local">): OutsideDoor {
  if (ALWAYS.has(t.cap)) return "open";
  if (t.local !== "none") return "off";
  if (t.toolset === "vault") return VAULT_PASTE.has(t.cap) ? "paste" : "off";
  if (OFF_TOOLSETS.has(t.toolset)) return "off";
  // the engineer tools read and change how the Space itself is set up: the person holds that role, or nobody here does. Reads too: the answer goes to a model Vyre cannot see.
  if (t.toolset === "engineer") return "ask";
  return isPersonOnly(t.cap, t.effects) ? "ask" : "open";
}

/** Runs as the agent itself. A tool that asks the person is not this. */
export function outsideAllows(t: Pick<ToolDef, "cap" | "toolset" | "effects" | "local">): boolean {
  return outsideDoor(t) === "open";
}
