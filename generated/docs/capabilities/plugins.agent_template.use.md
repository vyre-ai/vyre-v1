# plugins.agent_template.use

Make an agent from a sub-agent a plugin brought (its description becomes the role line and its prompt the start of AGENT.md)

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/plugins/agent_template/use |
| MCP tool | plugins_agent_template_use (agents) |
| CLI | none |
| Emits | plugin.changed, agent.created |

## Input

```ts
type In = {
  pluginId: string;
  name: string;
  agentName?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  agentId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentName": "example",
    "idempotencyKey": "idem_1",
    "name": "example",
    "pluginId": "plg_a1b2c3"
  },
  "output": {
    "agentId": "agt_a1b2c3"
  }
}
```
