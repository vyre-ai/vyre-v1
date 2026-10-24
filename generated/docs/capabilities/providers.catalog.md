# providers.catalog

The provider gallery from the definition files: name, logo, connection kinds, model list source, engine

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
| HTTP | POST /v1/providers/catalog |
| MCP tool | providers_catalog (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  providers: Array<{
      key: string;
      name: string;
      logo?: string;
      connections: Array<"subscription" | "api_key" | "local_model">;
      modelsSource: string;
      engine: string;
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
    "providers": [
      {
        "connections": [
          "subscription"
        ],
        "engine": "example",
        "key": "example",
        "logo": "example",
        "modelsSource": "example",
        "name": "example"
      }
    ]
  }
}
```
