# search.index.rebuild

Rebuild the index for an entity or the whole Space from the projections

| | |
|---|---|
| Module | search |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.services |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/search/index/rebuild |
| MCP tool | search_index_rebuild (engineer) |
| CLI | none |
| Emits | search.reindexed |

## Input

```ts
type In = {
  entity?: string;
};
```

## Output

```ts
type Out = {
  runId: string;
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
    "entity": "example"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
