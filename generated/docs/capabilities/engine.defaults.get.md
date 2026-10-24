# engine.defaults.get

The caller default model, provider, effort and fallback order in this Space

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
| HTTP | POST /v1/engine/defaults/get |
| MCP tool | engine_defaults_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  provider?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "max";
  fallback: Array<{
      provider: string;
      model: string;
      accountRef?: string;
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
  }
}
```
