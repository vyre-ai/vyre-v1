# projects.share_out

Make a read-only link to the project Overview for a client; it expires in 30 days unless expiresAt or expiresInDays says otherwise

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | records.share_external |
| Grant level | manage |
| Risk | high |
| Resource | project (/projectId) |
| Gate | send when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/share_out |
| MCP tool | projects_share_out (records) |
| CLI | none |
| Emits | project.shared_out |

## Input

```ts
type In = {
  projectId: string;
  expiresAt?: number;
  expiresInDays?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  url: string;
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
    "expiresInDays": 1,
    "idempotencyKey": "idem_1",
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "url": "example"
  }
}
```
