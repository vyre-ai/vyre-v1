# google.docs.batch_update

Edit a Google Doc with a list of requests

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | post |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/docs/batch_update |
| MCP tool | google_docs_batch_update (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  documentId: string;
  requests: Array<Record<string, unknown>>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  applied: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "documentId": "example",
    "idempotencyKey": "idem_1",
    "requests": [
      {}
    ]
  },
  "output": {
    "applied": 1
  }
}
```
