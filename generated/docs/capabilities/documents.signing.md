# documents.signing

Where the signers of a PDF made from a Vyre document sign, and what it was filled from

| | |
|---|---|
| Module | documents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/documents/signing |
| MCP tool | documents_signing (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  signers: Array<string>;
  places: Array<unknown>;
  stale?: boolean;
  plain?: boolean;
  unchecked?: boolean;
  checkedVersion?: string;
  checkedSha256?: string;
  templateFileId?: string;
  recordId?: string;
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
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "checkedSha256": "example",
    "checkedVersion": "example",
    "places": [
      {}
    ],
    "plain": true,
    "recordId": "rec_a1b2c3",
    "signers": [
      "example"
    ],
    "stale": true,
    "templateFileId": "fil_a1b2c3",
    "unchecked": true
  }
}
```
