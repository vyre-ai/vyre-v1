# google.docs.replace_text

Replace every occurrence of some text in a Google Doc

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
| HTTP | POST /v1/google/docs/replace_text |
| MCP tool | google_docs_replace_text (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  documentId: string;
  find: string;
  replace: string;
  matchCase?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  replaced: number;
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
    "find": "example",
    "idempotencyKey": "idem_1",
    "matchCase": true,
    "replace": "example"
  },
  "output": {
    "replaced": 1
  }
}
```
