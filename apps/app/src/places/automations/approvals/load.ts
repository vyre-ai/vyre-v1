// Reads what an approval card needs: the task the run waits on (tasks.list for that run), the step it waits at, and the sentences of the steps after it. A run that waits for anything else, or on
// someone else, comes back as null and nothing is drawn.
import { fromDefinition } from "../story/adapt.ts";
import { sentence } from "../story/model.ts";
import type { StepIn } from "../story/model.ts";
import { approvalCard } from "./model.ts";
import type { ApprovalCard, ApprovalTask } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Def = Parameters<typeof fromDefinition>[0];

const flat = (steps: readonly StepIn[]): StepIn[] =>
  steps.flatMap((s) => [s, ...flat(s.yes ?? []), ...flat(s.otherwise ?? []), ...flat(s.group?.steps ?? [])]);

/** Each step's sentence as the page says it, by step id. */
export function sentencesOf(def: Def): Map<string, string> {
  const story = fromDefinition(def, {
    catalog: {},
    triggerTitles: {},
    nameOfNode: (id) => id,
    canUse: () => true,
    needsOf: () => [],
  });
  return new Map(flat(story.steps).map((s) => [s.id, sentence(s).text]));
}

export async function loadApproval(i: {
  call: Call;
  me: string;
  automationId: string;
  runId: string;
  /** The definition, when the caller already has it. */
  def?: Def;
}): Promise<ApprovalCard | null> {
  const got = (await i
    .call("tasks.list", {
      scope: "run",
      runId: i.runId,
      kinds: ["approve"],
      states: ["awaiting_approval"],
      limit: 5,
    })
    .catch(() => null)) as { tasks?: ApprovalTask[] } | null;
  const task = got?.tasks?.[0];
  if (!task) return null;
  const def =
    i.def ??
    ((await i.call("automations.get", { automationId: i.automationId })) as { automation: { definition: Def } })
      .automation.definition;
  const steps = ((await i.call("runs.steps", { runId: i.runId })) as { steps: { step: string; state: string }[] })
    .steps;
  const at = steps.find((x) => x.state === "waiting")?.step;
  const node = def.nodes.find((n) => n.id === at) ?? def.nodes.find((n) => n.key === "approval");
  if (!node) return null;
  const words = sentencesOf(def);
  return approvalCard({
    task,
    me: i.me,
    node: { id: node.id, next: node.next, branches: node.branches },
    say: (id) => words.get(id),
  });
}
