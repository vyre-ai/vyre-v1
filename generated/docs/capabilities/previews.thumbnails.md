# previews.thumbnails

Thumbnails for a grid of files in one call

| | |
|---|---|
| Module | previews |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/previews/thumbnails |
| MCP tool | previews_thumbnails (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileIds: Array<string>;
  size?: "s" | "m" | "l" | "xl";
};
```

## Output

```ts
type Out = {
  items: Array<{
      fileId: string;
      ready: boolean;
      url?: string;
      width?: number;
      height?: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "fileIds": [
      "fil_a1b2c3"
    ],
    "size": "s"
  },
  "output": {
    "items": [
      {
        "fileId": "fil_a1b2c3",
        "height": 1,
        "ready": true,
        "url": "example",
        "width": 1
      }
    ]
  }
}
```
