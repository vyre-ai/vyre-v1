# agents.config.get

Parsed agent.toml and AGENT.md metadata as the next run will see them, with the last good version and any error

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
| HTTP | POST /v1/agents/config/get |
| MCP tool | agents_config_get (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  effective: Record<string, unknown>;
  lastGoodVersionId?: string;
  error?: {
    line?: number;
    message: string;
  };
  lines: {
    agentMd: number;
    vyreMd: number;
  };
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
    "effective": {},
    "error": {
      "line": 1,
      "message": "example"
    },
    "lastGoodVersionId": "ver_a1b2c3",
    "lines": {
      "agentMd": 1,
      "vyreMd": 1
    }
  }
}
```
