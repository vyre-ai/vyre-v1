# runs.wait_for

Wait in the background for an event, another Run or a time; ends the turn and wakes the thread on a match (default timeout 30 days)

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
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/wait_for |
| MCP tool | wait_for (automations) |
| CLI | none |
| Emits | run.started, run.waiting |

## Input

```ts
type In = {
  on: {
    event: string;
    filter?: unknown;
  } | {
    run: string;
  } | {
    at: number;
  };
  timeout?: string;
  subject?: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  threadId?: string;
  label?: string;
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
    "label": "example",
    "on": {
      "event": "record.updated",
      "filter": {}
    },
    "subject": {
      "id": "rec_a1b2c3",
      "type": "space"
    },
    "threadId": "thr_a1b2c3",
    "timeout": "30d"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
