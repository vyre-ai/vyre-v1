# spaces.transfer_ownership

Owner only: hand the Space to another person

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/spaces/transfer_ownership |
| MCP tool | spaces_transfer_ownership (meta) |
| CLI | none |
| Emits | space.ownership_transferred, access.changed |

## Input

```ts
type In = {
  to: string;
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
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "to": "usr_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
