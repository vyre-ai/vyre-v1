# mcp.connected.remove

Remove an outside agent: its tokens end at once, a call in flight fails, and the agent goes to Trash

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mcp/connected/remove |
| MCP tool | none |
| CLI | none |
| Emits | mcp.client_removed |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
