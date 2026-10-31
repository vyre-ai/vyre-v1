# google.docs.insert_text

Insert text into a Google Doc after or before some existing text, or at its start or end; refuses if the document changed meanwhile

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
| HTTP | POST /v1/google/docs/insert_text |
| MCP tool | google_docs_insert_text (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  documentId: string;
  text: string;
  where?: "after" | "before" | "start" | "end";
  anchor?: string;
  matchCase?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  inserted: boolean;
  index: number;
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
- validation.version_conflict

## Example

```json
{
  "name": "example",
  "input": {
    "anchor": "example",
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "documentId": "example",
    "idempotencyKey": "idem_1",
    "matchCase": true,
    "text": "example",
    "where": "after"
  },
  "output": {
    "index": 1,
    "inserted": true
  }
}
```
