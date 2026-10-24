# events.get

Read one event by id

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
| HTTP | POST /v1/events/get |
| MCP tool | events_get (meta) |
| CLI | vyre events get |
| Emits | none |

## Input

```ts
type In = {
  eventId: string;
};
```

## Output

```ts
type Out = {
  event: {
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
  };
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
    "eventId": "evt_a1b2c3"
  },
  "output": {
    "event": {
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
  }
}
```
