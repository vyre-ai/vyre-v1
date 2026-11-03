# file.redact_requested

An agent asked to read a file nobody has reviewed yet ("Redact before I can read")

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  requestId: string;
  fileId: string;
  name: string;
  agentId?: string;
  actingFor?: string;
  threadId?: string;
};
```
