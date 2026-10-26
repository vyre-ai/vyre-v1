# sessions.imported

A local Codex or Claude Code session was copied into an immutable owner-private archive

| | |
|---|---|
| Module | import |
| Schema version | 1 |
| Subject | entity at /conversationId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  conversationId: string;
  provider: "codex" | "claude_code";
  sourceKey: string;
  projectId?: string;
  messages: number;
};
```
