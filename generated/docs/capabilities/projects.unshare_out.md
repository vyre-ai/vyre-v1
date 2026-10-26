# projects.unshare_out

Revoke a read-only link to the project Overview; the link answers not found at once

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.share_external |
| Grant level | manage |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/unshare_out |
| MCP tool | projects_unshare_out (records) |
| CLI | none |
| Emits | project.unshared_out |

## Input

```ts
type In = {
  projectId: string;
  url: string;
};
```

## Output

```ts
type Out = {
  revoked: boolean;
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
    "projectId": "prj_a1b2c3",
    "url": "/share/project/a1b2c3"
  },
  "output": {
    "revoked": true
  }
}
```
