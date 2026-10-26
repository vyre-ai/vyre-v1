# documents.preview_fill

Show the filled document as an excerpt with every filled value marked, and what is missing or unused

| | |
|---|---|
| Module | documents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/templateFileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/documents/preview_fill |
| MCP tool | documents_preview_fill (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  templateFileId: string;
  values?: Record<string, unknown>;
  recordId?: string;
  recordType?: string;
  mapping?: Record<string, string>;
  signingDate?: string;
};
```

## Output

```ts
type Out = {
  excerpt: Array<{
      text: string;
      filled: Array<{
          from: number;
          to: number;
          field: string;
        }>;
    }>;
  missing: Array<string>;
  unused: Array<string>;
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
    "mapping": {},
    "recordId": "rec_a1b2c3",
    "recordType": "contact",
    "signingDate": "2026-10-24",
    "templateFileId": "fil_a1b2c3",
    "values": {}
  },
  "output": {
    "excerpt": [
      {
        "filled": [
          {
            "field": "example",
            "from": 1,
            "to": 1
          }
        ],
        "text": "example"
      }
    ],
    "missing": [
      "example"
    ],
    "unused": [
      "example"
    ]
  }
}
```
