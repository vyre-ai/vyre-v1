# memory.map.get

The MAP.md block of an agent as the nightly job last wrote it (agent layer only, never personal memory); absent before the first night

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/map/get |
| MCP tool | memory_map_get (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  map?: {
    body: string;
    lines: number;
    updatedAt: number;
  };
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
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "map": {
      "body": "example",
      "lines": 1,
      "updatedAt": 1760000000000
    }
  }
}
```
