# files.comments.list

List comments and numbered pins on a file; agents read pins to see what a person marked

| | |
|---|---|
| Module | files |
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
| HTTP | POST /v1/files/comments/list |
| MCP tool | files_comments_list (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  versionId?: string;
  includeResolved?: boolean;
};
```

## Output

```ts
type Out = {
  comments: Array<{
      commentId: string;
      fileId?: string;
      changesetId?: string;
      versionId?: string;
      anchor: {
        kind: "file" | "line" | "range" | "area" | "page" | "cell";
        line?: number;
        from?: number;
        to?: number;
        page?: number;
        box?: {
          x: number;
          y: number;
          w: number;
          h: number;
        };
        cell?: string;
        quote?: string;
        path?: string;
      };
      pin?: number;
      text: string;
      by: string;
      at: number;
      resolved: boolean;
      mentions: Array<string>;
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
    "fileId": "fil_a1b2c3",
    "includeResolved": true,
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "comments": [
      {
        "anchor": {
          "box": {
            "h": 1,
            "w": 1,
            "x": 1,
            "y": 1
          },
          "cell": "example",
          "from": 1,
          "kind": "file",
          "line": 1,
          "page": 1,
          "path": "example",
          "quote": "example",
          "to": 1
        },
        "at": 1760000000000,
        "by": "example",
        "changesetId": "chg_a1b2c3",
        "commentId": "fcm_a1b2c3",
        "fileId": "fil_a1b2c3",
        "mentions": [
          "example"
        ],
        "pin": 1,
        "resolved": true,
        "text": "example",
        "versionId": "ver_a1b2c3"
      }
    ]
  }
}
```
