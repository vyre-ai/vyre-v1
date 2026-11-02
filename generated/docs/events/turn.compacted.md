# turn.compacted

A chat was compacted (the quiet line in the thread): by the engine itself or by Vyre's summary, with the context it left

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  threadId: string;
  agentId: string;
  engine: string;
  how: "engine" | "vyre";
  kept: boolean;
  used?: number;
  window?: number;
  by: string;
};
```
