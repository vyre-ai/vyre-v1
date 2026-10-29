# providers.custom_list

The custom OpenAI-compatible endpoints this Space registered

| | |
|---|---|
| Module | vault |
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
| HTTP | POST /v1/providers/custom_list |
| MCP tool | providers_custom_list (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  endpoints: Array<{
      key: string;
      name: string;
      base: string;
      keyless: boolean;
      models: Array<string>;
      connected: number;
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
    "endpoints": [
      {
        "base": "example",
        "connected": 1,
        "key": "custom-acme-gateway",
        "keyless": true,
        "models": [
          "example"
        ],
        "name": "example"
      }
    ]
  }
}
```
