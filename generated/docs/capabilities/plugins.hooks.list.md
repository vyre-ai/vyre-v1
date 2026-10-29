# plugins.hooks.list

The hooks of the plugins that apply to this agent. They run only in the sandbox.

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
| HTTP | POST /v1/plugins/hooks/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId?: string;
};
```

## Output

```ts
type Out = {
  hooks: Array<{
      pluginId: string;
      plugin: string;
      event: string;
      matcher: string;
      command: string;
      args: Array<string>;
      timeoutSec?: number;
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
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "hooks": [
      {
        "args": [
          "example"
        ],
        "command": "example",
        "event": "PostToolUse",
        "matcher": "example",
        "plugin": "example",
        "pluginId": "plg_a1b2c3",
        "timeoutSec": 1
      }
    ]
  }
}
```
