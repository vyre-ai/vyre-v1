# memory.maintain

Nightly job: merge accepted facts, close old versions, rewrite MAP.md (under 200 lines) for each agent

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/maintain |
| MCP tool | none |
| CLI | none |
| Emits | memory.map_rewritten |

## Input

```ts
type In = {
  agentId?: string;
};
```

## Output

```ts
type Out = {
  merged: number;
  closed: number;
  maps: number;
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
    "closed": 1,
    "maps": 1,
    "merged": 1
  }
}
```
