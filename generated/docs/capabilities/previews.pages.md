# previews.pages

Page images of a PDF or Office file

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
| HTTP | POST /v1/previews/pages |
| MCP tool | previews_pages (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  versionId?: string;
  from?: number;
  count?: number;
  size?: "s" | "m" | "l" | "xl";
};
```

## Output

```ts
type Out = {
  total: number;
  pages: Array<{
      n: number;
      url: string;
      width: number;
      height: number;
    }>;
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
    "count": 1,
    "fileId": "fil_a1b2c3",
    "from": 1,
    "size": "s",
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "pages": [
      {
        "height": 1,
        "n": 1,
        "url": "example",
        "width": 1
      }
    ],
    "total": 1
  }
}
```
