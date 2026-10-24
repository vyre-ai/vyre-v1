# vault.exports.revoke

Close an export pull link early

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | vault.export |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/exports/revoke |
| MCP tool | vault_exports_revoke (vault) |
| CLI | none |
| Emits | vault.export_revoked |

## Input

```ts
type In = {
  exportId: string;
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
    "exportId": "vex_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
