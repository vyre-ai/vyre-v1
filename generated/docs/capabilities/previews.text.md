# previews.text

Extracted text of a PDF, Office, image-free or plain file, for the viewer, search and agents

| | |
|---|---|
| Module | previews |
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
| HTTP | POST /v1/previews/text |
| MCP tool | previews_text (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  versionId?: string;
  page?: number;
};
```

## Output

```ts
type Out = {
  text: string;
  pages?: number;
  truncated: boolean;
  source: "native" | "pdf" | "office" | "none";
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
    "fileId": "fil_a1b2c3",
    "page": 1,
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "pages": 1,
    "source": "native",
    "text": "example",
    "truncated": true
  }
}
```
