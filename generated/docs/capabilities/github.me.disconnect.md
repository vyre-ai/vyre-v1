# github.me.disconnect

Disconnect my GitHub: revoke it, delete the refresh token from my Vault and forget approvals

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/me/disconnect |
| MCP tool | none |
| CLI | none |
| Emits | github.me_disconnected |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  disconnected: boolean;
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
  "input": {},
  "output": {
    "disconnected": true
  }
}
```
