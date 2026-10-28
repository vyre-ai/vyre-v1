export function openedTask(target: { screen?: string; subject?: { type: string; id: string }; args: Record<string, string | undefined> }): string | null {
  return target.screen === "tasks.page" ? target.args.taskId ?? (target.subject?.type === "task" ? target.subject.id : null) : target.subject?.type === "task" ? target.subject.id : null;
}
