# portal.account_disable

Disable an outside account

| | |
|---|---|
| Module | portal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/portal/account_disable |
| MCP tool | portal_account_disable (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  accountId: string;
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "accountId": "pac_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
