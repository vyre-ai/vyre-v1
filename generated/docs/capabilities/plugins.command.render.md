# plugins.command.render

The prompt a plugin command stands for, with its arguments filled in; the chat sends it as the person's message

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
| HTTP | POST /v1/plugins/command/render |
| MCP tool | plugins_command (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
  args?: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  prompt: string;
  description: string;
  allowedTools: Array<string>;
  model?: string;
  pluginId: string;
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
    "agentId": "agt_a1b2c3",
    "args": "example",
    "name": "deploy-tools:status"
  },
  "output": {
    "allowedTools": [
      "example"
    ],
    "description": "example",
    "model": "example",
    "pluginId": "plg_a1b2c3",
    "prompt": "example"
  }
}
```
