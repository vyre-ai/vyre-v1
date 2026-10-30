# automations.http_send

Make a POST, PUT, PATCH or DELETE request to a public https address for an HTTP request step. Held by the Gate like any send. The key comes from a Vault handle and is never returned.

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/automations/http_send |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  json?: unknown;
  text?: string;
  auth?: {
    kind: "bearer" | "basic" | "header";
    handle: string;
    username?: string;
    header?: string;
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.precondition_failed
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "auth": {
      "handle": "#Acme_API",
      "header": "x-api-key",
      "kind": "bearer",
      "username": "example"
    },
    "headers": {},
    "idempotencyKey": "idem_1",
    "json": {},
    "method": "POST",
    "query": {},
    "text": "example",
    "url": "https://api.example.com/v1/items"
  },
  "output": {
    "body": {},
    "headers": {},
    "ok": true,
    "status": 1
  }
}
```
