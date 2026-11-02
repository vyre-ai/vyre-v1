# mcp.setup.set

Let an outside agent act for its person including setup, or take that back. Its person turns it on (they must hold the rights); its person or an owner or admin turns it off. Not a tool: no agent reaches it

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
| HTTP | POST /v1/mcp/setup/set |
| MCP tool | none |
| CLI | none |
| Emits | mcp.setup_changed |

## Input

```ts
type In = {
  agentId: string;
  setup: boolean;
};
```

## Output

```ts
type Out = {
  setup: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "setup": true
  },
  "output": {
    "setup": true
  }
}
```
