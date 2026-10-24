# run.started

A Run started

| | |
|---|---|
| Module | runs |
| Schema version | 1 |
| Subject | run at /runId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  runId: string;
  kind: "automation" | "automation_test" | "journey" | "journey_migrate" | "routine" | "campaign" | "deployment" | "runbook" | "wait" | "terminal" | "replay" | "other";
  name?: string;
  owner: string;
  subject?: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
    id: string;
  };
  definitionVersion?: number;
  parentRun?: string;
};
```
