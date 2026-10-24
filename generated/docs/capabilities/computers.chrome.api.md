# computers.chrome.api

Call a site backend with the session of this browser; non-GET calls pass the Gate

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | computers.use |
| Grant level | use |
| Risk | high |
| Resource | computer (/computerId) |
| Gate | post when input.method != 'GET' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/computers/chrome/api |
| MCP tool | chrome_api (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- timeout.deadline
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "body": {},
    "computerId": "cmt_a1b2c3",
    "headers": {},
    "idempotencyKey": "idem_1",
    "method": "GET",
    "url": "https://example.com/api/items"
  },
  "output": {
    "body": {},
    "headers": {},
    "status": 1
  }
}
```
