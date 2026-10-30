# memory.forget

Forget facts by id: they stop being recalled and stay in history

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/memory/forget |
| MCP tool | memory_forget (memory) |
| CLI | vyre memory forget |
| Emits | memory.removed |

## Input

```ts
type In = {
  factIds: Array<string>;
};
```

## Output

```ts
type Out = {
  removed: number;
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
    "factIds": [
      "fct_a1b2c3"
    ]
  },
  "output": {
    "removed": 1
  }
}
```
