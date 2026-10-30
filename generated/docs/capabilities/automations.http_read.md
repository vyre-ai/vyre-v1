# automations.http_read

Make a GET or HEAD request to a public https address for an HTTP request step. A private address is refused. The key comes from a Vault handle and is never returned.

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/http_read |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  method: "GET" | "HEAD";
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
- permission.no_grant
- provider.network
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
    "json": {},
    "method": "GET",
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
