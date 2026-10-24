# engine.probe_account

Test an account: reachable, signed in, models it can use

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
| HTTP | POST /v1/engine/probe_account |
| MCP tool | engine_probe_account (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  accountRef: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  models?: number;
  error?: {
    code: string;
    message: string;
    next: Array<{
        kind: string;
        label: string;
      }>;
    traceId: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "accountRef": "#Team_Anthropic_Key"
  },
  "output": {
    "error": {
      "code": "example",
      "message": "example",
      "next": [
        {
          "kind": "example",
          "label": "example"
        }
      ],
      "traceId": "0123456789abcdef0123456789abcdef"
    },
    "models": 1,
    "ok": true
  }
}
```
