# runs.start

Create a Run record (engine, Gate and other modules call this for any long-lived work)

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/start |
| MCP tool | none |
| CLI | none |
| Emits | run.started |

## Input

```ts
type In = {
  kind: "automation" | "automation_test" | "journey" | "journey_migrate" | "routine" | "campaign" | "deployment" | "runbook" | "wait" | "terminal" | "replay" | "other";
  name?: string;
  owner: string;
  subject?: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  definitionVersion?: number;
  parentRun?: string;
  threadId?: string;
  keyUsed?: string;
  modelUsed?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "definitionVersion": 1,
    "idempotencyKey": "idem_1",
    "keyUsed": "example",
    "kind": "automation",
    "modelUsed": "example",
    "name": "example",
    "owner": "example",
    "parentRun": "run_a1b2c3",
    "subject": {
      "id": "rec_a1b2c3",
      "type": "space"
    },
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
