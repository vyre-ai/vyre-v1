# agents.outside.connect

System: make the agent an app becomes when a person allows it. Called by mcp.oauth.allow, never by a client

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.create |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/agents/outside/connect |
| MCP tool | none |
| CLI | none |
| Emits | agent.created |

## Input

```ts
type In = {
  clientName: string;
};
```

## Output

```ts
type Out = {
  agentId: string;
  name: string;
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
    "clientName": "example"
  },
  "output": {
    "agentId": "agt_a1b2c3",
    "name": "example"
  }
}
```
