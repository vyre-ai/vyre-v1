# projects.overview_get

Read the Overview as Markdown with every block led by its id, the project's custom fields and the kinds of live block, so overview_edit can name what to change

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
| HTTP | POST /v1/projects/overview_get |
| MCP tool | overview_get (records) |
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
  markdown: string;
  properties: Array<{
      key: string;
      title: string;
      type: string;
      value?: unknown;
    }>;
  liveTypes: Array<"tasks" | "milestones" | "links" | "records" | "metric" | "ci" | "goal" | "people" | "status">;
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
    "liveTypes": [
      "tasks"
    ],
    "markdown": "example",
    "properties": [
      {
        "key": "example",
        "title": "example",
        "type": "example",
        "value": {}
      }
    ],
    "rev": 1
  }
}
```
