# previews.get

Get the preview of one file version at a size, or one page of it

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
| HTTP | POST /v1/previews/get |
| MCP tool | previews_get (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  versionId?: string;
  size?: "s" | "m" | "l" | "xl";
  page?: number;
};
```

## Output

```ts
type Out = {
  ready: boolean;
  url?: string;
  width?: number;
  height?: number;
  pages?: number;
  reason?: string;
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
    "size": "s",
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "height": 1,
    "pages": 1,
    "ready": true,
    "reason": "example",
    "url": "example",
    "width": 1
  }
}
```
