# automations.groups.list

List Groups with Automation counts

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/groups/list |
| MCP tool | automations_groups_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  groups: Array<{
      id: string;
      name: string;
      count: number;
      order: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "groups": [
      {
        "count": 1,
        "id": "agr_a1b2c3",
        "name": "example",
        "order": 1
      }
    ]
  }
}
```
