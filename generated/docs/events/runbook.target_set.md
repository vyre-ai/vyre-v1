# runbook.target_set

The Runs on target of a runbook changed

| | |
|---|---|
| Module | runbooks |
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
  target: {
    kind: "server" | "computer";
    computerId?: string;
  };
};
```
