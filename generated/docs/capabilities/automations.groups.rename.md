# automations.groups.rename

Rename a Group

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | automation_group (/groupId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/groups/rename |
| MCP tool | automations_groups_rename (automations) |
| CLI | none |
| Emits | automation.group_renamed |

## Input

```ts
type In = {
  groupId: string;
  name: string;
};
```

## Output

```ts
type Out = {
  group: {
    id: string;
    name: string;
    count: number;
    order: number;
  };
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
    "groupId": "agr_a1b2c3",
    "name": "example"
  },
  "output": {
    "group": {
      "count": 1,
      "id": "agr_a1b2c3",
      "name": "example",
      "order": 1
    }
  }
}
```
