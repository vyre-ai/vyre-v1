# projects.overview_doc.get

The Overview page: its blocks (text, headings and live blocks that hold only a spec), its revision and the project's custom fields for the page header

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
| HTTP | POST /v1/projects/overview_doc/get |
| MCP tool | projects_overview_doc_get (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
};
```

## Output

```ts
type Out = {
  rev: number;
  blocks: Array<{
      id: string;
      kind: "text" | "heading" | "live";
      text?: string;
      level?: number;
      live?: {
        type: "tasks" | "milestones" | "links" | "records" | "metric" | "ci" | "goal" | "people" | "status";
        spec: Record<string, unknown>;
        view?: "list" | "table" | "count" | "cards";
      };
      by?: string;
      at?: number;
    }>;
  markdown: string;
  properties: Array<{
      key: string;
      title: string;
      type: string;
      value?: unknown;
    }>;
  updatedBy?: string;
  updatedAt?: number;
  latest?: {
    rev: number;
    by: string;
    authorKind: "person" | "agent";
    summary: string;
    undoOf?: number;
    at: number;
  };
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
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "blocks": [
      {
        "at": 1760000000000,
        "by": "example",
        "id": "blk_a1b2c3",
        "kind": "text",
        "level": 1,
        "live": {
          "spec": {},
          "type": "tasks",
          "view": "list"
        },
        "text": "example"
      }
    ],
    "latest": {
      "at": 1760000000000,
      "authorKind": "person",
      "by": "example",
      "rev": 1,
      "summary": "example",
      "undoOf": 1
    },
    "markdown": "example",
    "properties": [
      {
        "key": "example",
        "title": "example",
        "type": "example",
        "value": {}
      }
    ],
    "rev": 1,
    "updatedAt": 1760000000000,
    "updatedBy": "example"
  }
}
```
