# audit.verify

Verify the hash chain and signed checkpoints over a range of events

| | |
|---|---|
| Module | audit |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | audit.read |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/audit/verify |
| MCP tool | audit_verify (engineer) |
| CLI | vyre audit verify |
| Emits | audit.verified |

## Input

```ts
type In = {
  fromSeq?: number;
  toSeq?: number;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  checked: number;
  firstBadSeq?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "fromSeq": 1,
    "toSeq": 1
  },
  "output": {
    "checked": 1,
    "firstBadSeq": 1,
    "ok": true
  }
}
```
