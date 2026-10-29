# memory.page.put

Write the Notes of a page as a new version (making the page when it is new); [[links]] in the Notes become labelled edges, each with the line it was written in

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
| HTTP | POST /v1/memory/page/put |
| MCP tool | memory_write_page (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  pageId?: string;
  title?: string;
  kind?: "person" | "client" | "project" | "agent" | "record" | "topic" | "decision" | "site";
  layer?: "person" | "agent" | "project" | "space";
  agentId?: string;
  projectId?: string;
  subjectRef?: string;
  notes: string;
  baseVersion?: number;
  reason?: string;
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
  created: boolean;
  links: number;
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
    "baseVersion": 1,
    "kind": "person",
    "layer": "person",
    "notes": "example",
    "pageId": "example",
    "projectId": "prj_a1b2c3",
    "reason": "example",
    "subjectRef": "example",
    "title": "example"
  },
  "output": {
    "created": true,
    "links": 1,
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
    }
  }
}
```
