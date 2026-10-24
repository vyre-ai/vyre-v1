# files.revoke_external

Revoke an outside link

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.share_external |
| Grant level | manage |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/revoke_external |
| MCP tool | files_revoke_external (files) |
| CLI | none |
| Emits | file.external_revoked |

## Input

```ts
type In = {
  fileId: string;
  linkId: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "linkId": "lnk_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
