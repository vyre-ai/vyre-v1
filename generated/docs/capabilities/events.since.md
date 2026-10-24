# events.since

Events after a cursor, in order, filtered for the reader; the catch-up call behind subscribe

| | |
|---|---|
| Module | events |
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
| HTTP | POST /v1/events/since |
| MCP tool | events_since (meta) |
| CLI | vyre events since |
| Emits | none |

## Input

```ts
type In = {
  after: number;
  types?: Array<string>;
  limit?: number;
};
```

## Output

```ts
type Out = {
  events: Array<{
      seq: number;
      id: string;
      type: string;
      sv: number;
      at: number;
      traceId: string;
      actor: string;
      onBehalf?: string;
      runId?: string;
      cause?: string;
      origin?: string;
      depth: number;
      subject?: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
        id: string;
      };
      payload: unknown;
    }>;
  next: number;
  head: number;
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
    "after": 1,
    "limit": 1,
    "types": [
      "example"
    ]
  },
  "output": {
    "events": [
      {
        "actor": "usr_a1b2c3",
        "at": 1760000000000,
        "cause": "evt_a1b2c3",
        "depth": 1,
        "id": "evt_a1b2c3",
        "onBehalf": "example",
        "origin": "automation:aut_a1b2c3",
        "payload": {},
        "runId": "run_a1b2c3",
        "seq": 1,
        "subject": {
          "id": "rec_a1b2c3",
          "type": "space"
        },
        "sv": 1,
        "traceId": "0123456789abcdef0123456789abcdef",
        "type": "record.updated"
      }
    ],
    "head": 1,
    "next": 1
  }
}
```
