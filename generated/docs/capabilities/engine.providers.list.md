# engine.providers.list

AI providers and engines (API and CLI) with whether each is connected and allowed for the open labels

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/providers/list |
| MCP tool | engine_providers_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId?: string;
};
```

## Output

```ts
type Out = {
  providers: Array<{
      driver: "anthropic" | "openai" | "openrouter" | "google" | "xai" | "opencode_go" | "local" | "claude_code" | "codex" | "grok";
      kind: "api" | "cli";
      title: string;
      connected: boolean;
      allowed: boolean;
      reason?: string;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "providers": [
      {
        "allowed": true,
        "connected": true,
        "driver": "anthropic",
        "kind": "api",
        "reason": "example",
        "title": "example"
      }
    ]
  }
}
```
