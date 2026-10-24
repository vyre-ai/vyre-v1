# scheduler.waits.list

List open waits by Run, subject or thread

| | |
|---|---|
| Module | scheduler-api |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/scheduler/waits/list |
| MCP tool | scheduler_waits_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId?: string;
  subject?: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
    id: string;
  };
  threadId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  waits: Array<{
      id: string;
      runId: string;
      on: {
        event: string;
        filter?: unknown;
      } | {
        run: string;
      } | {
        at: number;
      };
      subject?: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
        id: string;
      };
      threadId?: string;
      stepId?: string;
      expiresAt: number;
      cancelsOn: Array<string>;
      state: "open" | "matched" | "expired" | "canceled";
      createdAt: number;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "runId": "run_a1b2c3",
    "subject": {
      "id": "rec_a1b2c3",
      "type": "space"
    },
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "next": "example",
    "total": 1,
    "waits": [
      {
        "cancelsOn": [
          "example"
        ],
        "createdAt": 1760000000000,
        "expiresAt": 1760000000000,
        "id": "wat_a1b2c3",
        "on": {
          "event": "example",
          "filter": {}
        },
        "runId": "run_a1b2c3",
        "state": "open",
        "stepId": "example",
        "subject": {
          "id": "rec_a1b2c3",
          "type": "space"
        },
        "threadId": "thr_a1b2c3"
      }
    ]
  }
}
```
