# mcp.connected.list

The outside agents you connected; with all, every outside agent in the Space (owners and admins, Console)

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mcp/connected/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  all?: boolean;
};
```

## Output

```ts
type Out = {
  agents: Array<{
      agentId: string;
      clientName: string;
      redirectHost?: string;
      connectedAt: number;
      lastSeenAt?: number;
      calls: number;
      setup?: boolean;
      person?: string;
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
    "all": true
  },
  "output": {
    "agents": [
      {
        "agentId": "agt_a1b2c3",
        "calls": 1,
        "clientName": "example",
        "connectedAt": 1760000000000,
        "lastSeenAt": 1760000000000,
        "person": "example",
        "redirectHost": "example",
        "setup": true
      }
    ]
  }
}
```
