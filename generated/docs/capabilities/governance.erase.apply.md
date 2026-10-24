# governance.erase.apply

Erase what a finding lists: tombstones are written, an audit entry records who and when, the next backup rotation purges the rest

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/governance/erase/apply |
| MCP tool | governance_erase_apply (engineer) |
| CLI | none |
| Emits | erase.started, erase.completed |

## Input

```ts
type In = {
  findingId: string;
  include: Array<"records" | "files" | "chats" | "inbox" | "mail" | "calls" | "memory" | "runs">;
  overrideHold?: {
    reason: string;
  };
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
- permission.needs_team
- permission.no_grant
- permission.on_hold
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "findingId": "fnd_a1b2c3",
    "idempotencyKey": "idem_1",
    "include": [
      "records"
    ],
    "overrideHold": {
      "reason": "example"
    }
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
