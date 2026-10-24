# access.view_as

Preview what a member sees: a read-only preview session for 10 minutes (audited)

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | access.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/access/view_as |
| MCP tool | access_view_as (engineer) |
| CLI | none |
| Emits | view_as.started |

## Input

```ts
type In = {
  person: string;
};
```

## Output

```ts
type Out = {
  previewToken: string;
  expiresAt: number;
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
    "person": "usr_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "previewToken": "example"
  }
}
```
