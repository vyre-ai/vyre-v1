# file.agent_read

An agent read a file from a Redacted folder, or one with parts hidden from AI

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
  fileId: string;
  version: number;
  redacted: boolean;
  agentId?: string;
  actingFor?: string;
};
```
