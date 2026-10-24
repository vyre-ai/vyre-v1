# files.markup.get

Read freehand markup (Draw) saved on an image or page

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
| HTTP | POST /v1/files/markup/get |
| MCP tool | files_markup_get (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  page?: number;
};
```

## Output

```ts
type Out = {
  strokes: Array<{
      page?: number;
      color: string;
      width: number;
      points: Array<Array<number>>;
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
    "page": 1
  },
  "output": {
    "strokes": [
      {
        "color": "example",
        "page": 1,
        "points": [
          [
            1
          ]
        ],
        "width": 1
      }
    ]
  }
}
```
