# plugins.agent_templates.list

Sub-agents that installed plugins bring, as templates a new agent can start from

| | |
|---|---|
| Module | agents |
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
| HTTP | POST /v1/plugins/agent_templates/list |
| MCP tool | plugins_agent_templates (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  templates: Array<{
      pluginId: string;
      plugin: string;
      name: string;
      description: string;
      tools: Array<string>;
      model?: string;
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
  "input": {},
  "output": {
    "templates": [
      {
        "description": "example",
        "model": "example",
        "name": "example",
        "plugin": "example",
        "pluginId": "plg_a1b2c3",
        "tools": [
          "example"
        ]
      }
    ]
  }
}
```
