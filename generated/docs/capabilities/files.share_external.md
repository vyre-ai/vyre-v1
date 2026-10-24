# files.share_external

Make a view-only link to a file for someone outside the Space, with an expiry

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | files.share_external |
| Grant level | manage |
| Risk | high |
| Resource | file (/fileId) |
| Gate | send when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/share_external |
| MCP tool | files_share_external (files) |
| CLI | none |
| Emits | file.shared_external |

## Input

```ts
type In = {
  fileId: string;
  expiresAt?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  url: string;
  linkId: string;
  expiresAt?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "expiresAt": 1760000000000,
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "expiresAt": 1760000000000,
    "linkId": "lnk_a1b2c3",
    "url": "example"
  }
}
```
