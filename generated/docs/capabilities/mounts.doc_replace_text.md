# mounts.doc_replace_text

Replace text in a mounted Google Doc, in the Doc itself; the change shows in its Google version history

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
| HTTP | POST /v1/mounts/doc_replace_text |
| MCP tool | mounts_doc_replace_text (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
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
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed
- validation.unsupported

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
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
