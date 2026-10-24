# scheduler.waits.register

Register a background wait on an event, a Run or a time with a timeout (default 30 days) and cancel conditions

| | |
|---|---|
| Module | scheduler-api |
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
| HTTP | POST /v1/scheduler/waits/register |
| MCP tool | none |
| CLI | none |
| Emits | wait.registered |

## Input

```ts
type In = {
  runId: string;
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
  stepId?: string;
  cancelsOn?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  waitId: string;
  expiresAt: number;
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
    "cancelsOn": [
      "example"
    ],
    "idempotencyKey": "idem_1",
    "on": {
      "event": "example",
      "filter": {}
    },
    "runId": "run_a1b2c3",
    "stepId": "example",
    "subject": {
      "id": "rec_a1b2c3",
      "type": "space"
    },
    "threadId": "thr_a1b2c3",
    "timeout": "30d"
  },
  "output": {
    "expiresAt": 1760000000000,
    "waitId": "wat_a1b2c3"
  }
}
```
