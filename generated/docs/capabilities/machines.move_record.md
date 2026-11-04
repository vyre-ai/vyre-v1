# machines.move_record

Engine only: keep the line of a turn that Automatic moved off a machine with no room

| | |
|---|---|
| Module | machines |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/machines/move_record |
| MCP tool | machines_move_record (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  turnId?: string;
  asker?: string;
  agentId?: string;
  threadId?: string;
  from: string;
  to: string;
  why: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "agentId": "example",
    "asker": "example",
    "from": "example",
    "threadId": "example",
    "to": "example",
    "turnId": "example",
    "why": "example"
  },
  "output": {
    "ok": true
  }
}
```
