# views.delete

Delete a saved view

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/views/delete |
| MCP tool | views_delete (records) |
| CLI | none |
| Emits | view.deleted |

## Input

```ts
type In = {
  viewId: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "viewId": "viw_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
