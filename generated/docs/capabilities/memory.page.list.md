# memory.page.list

List the pages the reader can see, by words in the title or Notes, layer, kind, agent or project

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/page/list |
| MCP tool | memory_page_list (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q?: string;
  layer?: "person" | "agent" | "project" | "space";
  kind?: "person" | "client" | "project" | "agent" | "record" | "topic" | "decision" | "site";
  agentId?: string;
  projectId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  pages: Array<{
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
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "cursor": "example",
    "kind": "person",
    "layer": "person",
    "limit": 1,
    "projectId": "prj_a1b2c3",
    "q": "example"
  },
  "output": {
    "next": "example",
    "pages": [
      {
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
    ],
    "total": 1
  }
}
```
