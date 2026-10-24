# identity.passkey_remove

Remove a passkey (ships later)

| | |
|---|---|
| Module | identity |
| Version | 1 (since 1.1.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/identity/passkey_remove |
| MCP tool | identity_passkey_remove (meta) |
| CLI | none |
| Emits | factor.removed |

## Input

```ts
type In = {
  name: string;
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
    "name": "example"
  },
  "output": {
    "ok": true
  }
}
```
