# runbook.run_started

A runbook run began

| | |
|---|---|
| Module | runbooks |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  runId: string;
  fileId: string;
  target: {
    kind: "server" | "computer";
    computerId?: string;
  };
  blocks: number;
  all: boolean;
  by: string;
};
```
