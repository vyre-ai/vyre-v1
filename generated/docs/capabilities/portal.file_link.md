# portal.file_link

Make a short-lived scoped link to a file for an outside account

| | |
|---|---|
| Module | portal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/portal/file_link |
| MCP tool | portal_file_link (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  accountId: string;
  fileId: string;
  expiresInMinutes: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  url: string;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "accountId": "pac_a1b2c3",
    "expiresInMinutes": 1,
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "expiresAt": 1760000000000,
    "url": "example"
  }
}
```
