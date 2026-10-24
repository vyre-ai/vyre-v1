# spaces.leave

Leave this Space; the local folder is wiped and the server stops serving this person (the owner must transfer first)

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/spaces/leave |
| MCP tool | spaces_leave (meta) |
| CLI | none |
| Emits | member.removed, principal.suspended |

## Input

```ts
type In = {
  confirm: true;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "confirm": true
  },
  "output": {
    "ok": true
  }
}
```
