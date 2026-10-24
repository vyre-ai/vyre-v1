# automations.groups.delete

Delete a Group; its Automations become ungrouped

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | automation_group (/groupId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/groups/delete |
| MCP tool | automations_groups_delete (automations) |
| CLI | none |
| Emits | automation.group_deleted |

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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "groupId": "agr_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
