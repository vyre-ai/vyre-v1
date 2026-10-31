# mounts.doc_insert_text

Insert text into a mounted Google Doc after or before some existing text, or at its start or end; refuses if the Doc changed meanwhile

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | edit |
| Risk | high |
| Resource | file (/fileId) |
| Gate | post |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mounts/doc_insert_text |
| MCP tool | mounts_doc_insert_text (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
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
- validation.not_found
- validation.precondition_failed
- validation.unsupported
- validation.version_conflict

## Example

```json
{
  "name": "example",
  "input": {
    "anchor": "example",
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "matchCase": true,
    "text": "example",
    "where": "after"
  },
  "output": {
    "inserted": true
  }
}
```
