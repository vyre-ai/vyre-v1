# engine.defaults.set

Set the caller default model, provider, effort and fallback order (the chat default)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/defaults/set |
| MCP tool | engine_defaults_set (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  provider?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "max";
  fallback?: Array<{
      provider: string;
      model: string;
      accountRef?: string;
    }>;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "effort": "low",
    "fallback": [
      {
        "accountRef": "#Team_Anthropic_Key",
        "model": "example",
        "provider": "example"
      }
    ],
    "model": "example",
    "provider": "example"
  },
  "output": {
    "ok": true
  }
}
```
