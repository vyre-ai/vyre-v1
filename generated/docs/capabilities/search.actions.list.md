# search.actions.list

Actions offered after the > prefix (New task, Call someone, Switch skin, Set yourself away, Go offline)

| | |
|---|---|
| Module | search |
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
| HTTP | POST /v1/search/actions/list |
| MCP tool | search_actions_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q?: string;
};
```

## Output

```ts
type Out = {
  actions: Array<{
      key: string;
      title: string;
      icon: string;
      cap?: string;
      keys?: string;
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
  "input": {
    "q": "example"
  },
  "output": {
    "actions": [
      {
        "cap": "example",
        "icon": "example",
        "key": "task.new",
        "keys": "example",
        "title": "New task"
      }
    ]
  }
}
```
