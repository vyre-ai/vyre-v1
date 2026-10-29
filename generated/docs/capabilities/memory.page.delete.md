# memory.page.delete

Move a page to Trash; memory.restore brings it back

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/page/delete |
| MCP tool | memory_page_delete (memory) |
| CLI | none |
| Emits | memory.removed |

## Input

```ts
type In = {
  pageId: string;
};
```

## Output

```ts
type Out = {
  page: {
    pageId: string;
    title: string;
    kind: "person" | "client" | "project" | "agent" | "record" | "topic" | "decision" | "site";
    layer: "person" | "agent" | "project" | "space";
    ownerRef: string;
    agentId?: string;
    projectId?: string;
    subjectRef?: string;
    version: number;
    createdAt: number;
    updatedAt: number;
    trashedAt?: number;
    archivedAt?: number;
  };
  trashed: boolean;
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
    "pageId": "example"
  },
  "output": {
    "page": {
      "agentId": "agt_a1b2c3",
      "archivedAt": 1760000000000,
      "createdAt": 1760000000000,
      "kind": "person",
      "layer": "person",
      "ownerRef": "example",
      "pageId": "example",
      "projectId": "prj_a1b2c3",
      "subjectRef": "example",
      "title": "example",
      "trashedAt": 1760000000000,
      "updatedAt": 1760000000000,
      "version": 1
    },
    "trashed": true
  }
}
```
