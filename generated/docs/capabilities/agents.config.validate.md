# agents.config.validate

Validate agent.toml text (app limits first, then precedence) without saving

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | agent (/agentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/config/validate |
| MCP tool | agents_config_validate (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  toml: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  errors: Array<{
      line?: number;
      message: string;
    }>;
  widens: Array<string>;
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
    "toml": "example"
  },
  "output": {
    "errors": [
      {
        "line": 1,
        "message": "example"
      }
    ],
    "ok": true,
    "widens": [
      "example"
    ]
  }
}
```
