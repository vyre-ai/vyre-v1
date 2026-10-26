// Builders for the projects tests: calling a capability through the handler table, and a project with a few tasks.
import { grantOnProject, handlers } from "../impl.ts";
import { DAY, NOW } from "./harness.ts";
import type { Harness } from "./harness.ts";
import type { ProjectsCtx } from "../projections.ts";

type AnyHandler = (ctx: ProjectsCtx, input: any) => Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const table = handlers as unknown as Record<string, AnyHandler>;

let n = 0;
export const key = (): string => `k${++n}`;
/** Call a capability as the harness's caller (or another ctx); keyed capabilities get a fresh key unless the input has one. */
export function run(h: Harness, cap: string, input: Record<string, unknown>, ctx: ProjectsCtx = h.ctx): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const f = table[cap];
  if (!f) throw new Error(`no handler for ${cap}`);
  const keyed = new Set(["projects.create", "projects.from_channel", "projects.members.set", "projects.apply_cascade"]);
  return f(ctx, keyed.has(cap) && input["idempotencyKey"] === undefined ? { ...input, idempotencyKey: key() } : input);
}

export interface Made { projectId: string; recordId: string; channelId: string; folderId: string }
/** Makes a project the way the host does: the call, then the `project.created` consumer that grants the starting members on the committed project. */
export const mkProject = async (h: Harness, over: Record<string, unknown> = {}): Promise<Made> => {
  const made = await run(h, "projects.create", { type: "project", title: "Probate GTM", ...over }) as Made;
  await grantOnProject(h.ctx, made.projectId);
  return made;
};

export interface Chain { p: Made; a: string; b: string; c: string }
/** Three tasks in a row, each starting the day the one before is due: A (day 1 to 3), B (3 to 5), C (5 to 8), with arrows A to B and B to C. */
export async function mkChain(h: Harness): Promise<Chain> {
  const p = await mkProject(h);
  const a = h.task(p, { title: "Draft", start: NOW + DAY, due: NOW + 3 * DAY });
  const b = h.task(p, { title: "Review", start: NOW + 3 * DAY, due: NOW + 5 * DAY });
  const c = h.task(p, { title: "Publish", start: NOW + 5 * DAY, due: NOW + 8 * DAY });
  await run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b });
  await run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: b, toTaskId: c });
  h.clear();
  return { p, a, b, c };
}
