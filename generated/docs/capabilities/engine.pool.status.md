# engine.pool.status

Warm engine pool: sessions per driver, warm hits, evictions

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/pool/status |
| MCP tool | engine_pool_status (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  sessions: Array<{
      driver: "anthropic" | "openai" | "openrouter" | "google" | "xai" | "opencode_go" | "local" | "claude_code" | "codex" | "grok";
      warm: number;
      max: number;
      hits: number;
      misses: number;
    }>;
  totalWarm: number;
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
    "sessions": [
      {
        "driver": "anthropic",
        "hits": 1,
        "max": 1,
        "misses": 1,
        "warm": 1
      }
    ],
    "totalWarm": 1
  }
}
```
