// What an outside agent may call. There is no scope list: it can use what the person who allowed it can, and the invoke pipeline makes that true on every call (agent and person must both allow, ARCH 4.5 rule 5). This file
// narrows only what the MCP door must never offer, and it never widens anything.
//   Off here   the terminal, Vyre computers and every tool that runs on a machine of ours (it has its own machine), the Vault toolset (a value never leaves, and a handle is no use outside a Vyre turn), and the engineer toolset.
//   A person's own   signing in, devices, members, access, the rules of the Gate, and the company's connections stay with people. An agent cannot allow another client, cannot widen what it was given, and cannot change who gets in.
import type { ToolDef } from "../tools/types.ts";

const OFF_TOOLSETS: ReadonlySet<string> = new Set(["vault", "terminal", "computer", "engineer"]);

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

export function outsideAllows(t: Pick<ToolDef, "cap" | "toolset" | "effects" | "local">): boolean {
  if (ALWAYS.has(t.cap)) return true;
  if (OFF_TOOLSETS.has(t.toolset) || t.local !== "none") return false;
  return !isPersonOnly(t.cap, t.effects);
}
