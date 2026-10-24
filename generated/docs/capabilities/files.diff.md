# files.diff

Compare two versions of a file, or a version with the current one: unified or split hunks, word marks, paragraph diff for docx and md, image blobs for the slider

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
| HTTP | POST /v1/files/diff |
| MCP tool | files_diff (files) |
| CLI | vyre files diff |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  from?: string;
  to?: string;
  mode?: "unified" | "split" | "words" | "paragraph";
};
```

## Output

```ts
type Out = {
  kind: "text" | "paragraph" | "image" | "binary";
  added: number;
  removed: number;
  hunks: Array<{
      hunkId: string;
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: Array<{
          op: "ctx" | "add" | "del";
          text: string;
          marks?: Array<{
              from: number;
              to: number;
            }>;
        }>;
    }>;
  images?: {
    left?: string;
    right?: string;
  };
  identical: boolean;
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
    "from": "ver_a1b2c3",
    "mode": "unified",
    "to": "ver_a1b2c3"
  },
  "output": {
    "added": 1,
    "hunks": [
      {
        "hunkId": "example",
        "lines": [
          {
            "marks": [
              {
                "from": 1,
                "to": 1
              }
            ],
            "op": "ctx",
            "text": "example"
          }
        ],
        "newLines": 1,
        "newStart": 1,
        "oldLines": 1,
        "oldStart": 1
      }
    ],
    "identical": true,
    "images": {
      "left": "blb_a1b2c3",
      "right": "blb_a1b2c3"
    },
    "kind": "text",
    "removed": 1
  }
}
```
