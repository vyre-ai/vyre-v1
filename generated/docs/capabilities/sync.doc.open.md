# sync.doc.open

Open a Yjs document: snapshot, pending updates and state vector (checked with authorize view)

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync/doc/open |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  doc: string;
  sv?: string;
};
```

## Output

```ts
type Out = {
  snapshot?: string;
  updates: Array<string>;
  sv: string;
  upto: number;
  md?: string;
  enc: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "doc": "not_a1b2c3",
    "sv": "example"
  },
  "output": {
    "enc": 1,
    "md": "example",
    "snapshot": "example",
    "sv": "example",
    "updates": [
      "example"
    ],
    "upto": 1
  }
}
```
