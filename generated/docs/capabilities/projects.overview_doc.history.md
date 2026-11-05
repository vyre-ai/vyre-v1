# projects.overview_doc.history

The Overview's revisions, newest first, each with who made it and what changed

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/overview_doc/history |
| MCP tool | projects_overview_doc_history (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  revisions: Array<{
      rev: number;
      by: string;
      authorKind: "person" | "agent";
      summary: string;
      undoOf?: number;
      at: number;
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
    "limit": 1,
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "revisions": [
      {
        "at": 1760000000000,
        "authorKind": "person",
        "by": "example",
        "rev": 1,
        "summary": "example",
        "undoOf": 1
      }
    ]
  }
}
```
