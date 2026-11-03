// The contract checks the Chats tests use, from the validator files of the modules whose capabilities they call (not the whole generated/validators.ts, which under tsx costs 3.5 s cold).
// A capability from another module throws "unknown capability": add that module here.
import { checkIn } from "../../../generated/validators/core.ts";
import { validators as access } from "../../../generated/validators/access.ts";
import { validators as agents } from "../../../generated/validators/agents.ts";
import { validators as chat } from "../../../generated/validators/chat.ts";
import { validators as mcp } from "../../../generated/validators/mcp.ts";
import { validators as spaces } from "../../../generated/validators/spaces.ts";
import { validators as tasks } from "../../../generated/validators/tasks.ts";
import { validators as terminal } from "../../../generated/validators/terminal.ts";

const CHECKS = { ...access, ...agents, ...chat, ...mcp, ...spaces, ...tasks, ...terminal };
export const validateInput = (cap: string, v: number, input: unknown): string[] => checkIn(CHECKS, "in", cap, v, input);
