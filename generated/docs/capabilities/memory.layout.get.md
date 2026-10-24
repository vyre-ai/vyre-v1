# memory.layout.get

Saved node positions for a graph

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
| HTTP | POST /v1/memory/layout/get |
| MCP tool | memory_layout_get (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope: "agent" | "space";
  agentId?: string;
};
```

## Output

```ts
type Out = {
  positions: Record<string, {
      x: number;
      y: number;
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
    "agentId": "agt_a1b2c3",
    "scope": "agent"
  },
  "output": {
    "positions": {}
  }
}
```
