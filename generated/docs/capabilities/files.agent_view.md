# files.agent_view

What an agent gets of a file now (Preview as agent): its text with [REDACTED], its name and path as agents read them, or why it gets nothing

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
| HTTP | POST /v1/files/agent_view |
| MCP tool | none |
| CLI | none |
| Emits | file.needs_review, file.agent_read |

## Input

```ts
type In = {
  fileId: string;
  versionId?: string;
};
```

## Output

```ts
type Out = {
  state: "clear" | "redacted" | "needs" | "off";
  name: string;
  path: string;
  text: string | null;
  boxes?: Array<{
      page: number;
      box: {
        x: number;
        y: number;
        w: number;
        h: number;
      } | null;
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
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "boxes": [
      {
        "box": {
          "h": 1,
          "w": 1,
          "x": 1,
          "y": 1
        },
        "page": 1
      }
    ],
    "name": "example",
    "path": "example",
    "state": "clear",
    "text": "example"
  }
}
```
