# google.dwd.probe

Mint a token for a probe user and call users.getProfile to prove the delegation and scopes

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/dwd/probe |
| MCP tool | google_dwd_probe (engineer) |
| CLI | none |
| Emits | google.dwd_probed |

## Input

```ts
type In = {
  as?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  email?: string;
  scopesMissing: Array<string>;
  detail?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com"
  },
  "output": {
    "detail": "example",
    "email": "maya@example.com",
    "ok": true,
    "scopesMissing": [
      "example"
    ]
  }
}
```
