# memory.page.set_visibility

Change who can see a page: move it to the Space, a project, an agent or the caller's own personal layer; its Notes, versions and links go with it

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
| HTTP | POST /v1/memory/page/set_visibility |
| MCP tool | memory_page_set_visibility (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  pageId: string;
  layer: "person" | "agent" | "project" | "space";
  agentId?: string;
  projectId?: string;
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
    subtitle?: string;
    blurb?: string;
    visibleTo?: string;
  };
  moved: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "layer": "person",
    "pageId": "example",
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "moved": true,
    "page": {
      "agentId": "agt_a1b2c3",
      "archivedAt": 1760000000000,
      "blurb": "example",
      "createdAt": 1760000000000,
      "kind": "person",
      "layer": "person",
      "ownerRef": "example",
      "pageId": "example",
      "projectId": "prj_a1b2c3",
      "subjectRef": "example",
      "subtitle": "example",
      "title": "example",
      "trashedAt": 1760000000000,
      "updatedAt": 1760000000000,
      "version": 1,
      "visibleTo": "example"
    }
  }
}
```
