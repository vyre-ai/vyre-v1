# automations.groups.create

Create a Group

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.personal |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/groups/create |
| MCP tool | automations_groups_create (automations) |
| CLI | none |
| Emits | automation.group_created |

## Input

```ts
type In = {
  name: string;
  idempotencyKey: string;
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
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
