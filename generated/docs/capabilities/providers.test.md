# providers.test

Test a provider connection and list the models it offers

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
| HTTP | POST /v1/providers/test |
| MCP tool | providers_test (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  providerId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  models: Array<string>;
  latencyMs: number;
  detail?: string;
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
    "providerId": "prv_a1b2c3"
  },
  "output": {
    "detail": "example",
    "latencyMs": 1,
    "models": [
      "example"
    ],
    "ok": true
  }
}
```
