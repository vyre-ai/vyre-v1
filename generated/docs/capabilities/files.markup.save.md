# files.markup.save

Save freehand markup on an image or page

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/markup/save |
| MCP tool | files_markup_save (files) |
| CLI | none |
| Emits | file.markup_saved |

## Input

```ts
type In = {
  fileId: string;
  page?: number;
  strokes: Array<{
      color: string;
      width: number;
      points: Array<Array<number>>;
    }>;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "strokes": [
      {
        "color": "example",
        "points": [
          [
            1
          ]
        ],
        "width": 1
      }
    ]
  },
  "output": {
    "ok": true
  }
}
```
