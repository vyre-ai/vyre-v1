# access.groups.delete

Delete a group; grants given to it go with it

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/access/groups/delete |
| MCP tool | access_groups_delete (engineer) |
| CLI | none |
| Emits | access.changed, grant.revoked |

## Input

```ts
type In = {
  groupId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.field_locked

## Example

```json
{
  "name": "example",
  "input": {
    "groupId": "grp_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
