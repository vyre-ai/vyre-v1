// What an agent row says it is, for code that reads agents.list or agents.get. The `kind` column decides (hole 18); the role line is words a person edits. A server from before the column sends no kind,
// so there, and only there, the old role word still finds the assistant while a newer app talks to an older server.
export interface AgentKindRow { kind?: string | undefined; role?: string | undefined }

export const isAssistantRow = (a: AgentKindRow): boolean => (a.kind === undefined ? a.role === "assistant" : a.kind === "assistant");
